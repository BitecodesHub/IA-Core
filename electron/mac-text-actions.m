#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <limits.h>
#import <stdio.h>
#import <unistd.h>

static const NSUInteger MaxTextBytes = 32 * 1024;
static const NSUInteger MaxOutputBytes = 256 * 1024;

typedef struct {
    pid_t pid;
    AXUIElementRef application;
    AXUIElementRef element;
} FocusSnapshot;

static NSDictionary *Failure(NSString *code, NSString *error) {
    return @{ @"ok": @NO, @"code": code, @"error": error };
}

static void Emit(NSDictionary *result) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
    if (!json || json.length + 1 > MaxOutputBytes) {
        json = [NSJSONSerialization dataWithJSONObject:Failure(@"OUTPUT_TOO_LARGE", @"The helper response exceeds its size limit.") options:0 error:NULL];
    }
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
}

static BOOL Trusted(BOOL prompt) {
    NSDictionary *options = @{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: @(prompt) };
    return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
}

// Query only the captured focused element. Never traverse parents or children.
static id CopyAttribute(AXUIElementRef element, CFStringRef attribute, AXError *error) {
    CFTypeRef value = NULL;
    AXError result = AXUIElementCopyAttributeValue(element, attribute, &value);
    if (error) *error = result;
    return value ? CFBridgingRelease(value) : nil;
}

static void ReleaseFocus(FocusSnapshot *focus) {
    if (focus->element) CFRelease(focus->element);
    if (focus->application) CFRelease(focus->application);
}

static BOOL FocusUnchanged(const FocusSnapshot *focus) {
    if ([NSWorkspace sharedWorkspace].frontmostApplication.processIdentifier != focus->pid) return NO;
    CFTypeRef current = NULL;
    AXError error = AXUIElementCopyAttributeValue(focus->application, kAXFocusedUIElementAttribute, &current);
    BOOL same = error == kAXErrorSuccess && current && CFGetTypeID(current) == AXUIElementGetTypeID() && CFEqual(current, focus->element);
    if (current) CFRelease(current);
    return same && [NSWorkspace sharedWorkspace].frontmostApplication.processIdentifier == focus->pid;
}

static NSDictionary *CaptureFocus(FocusSnapshot *focus) {
    focus->pid = [NSWorkspace sharedWorkspace].frontmostApplication.processIdentifier;
    if (focus->pid <= 0) return Failure(@"NO_FOCUS", @"No frontmost application is available.");
    focus->application = AXUIElementCreateApplication(focus->pid);
    AXUIElementSetMessagingTimeout(focus->application, 0.2f);
    CFTypeRef element = NULL;
    AXError error = AXUIElementCopyAttributeValue(focus->application, kAXFocusedUIElementAttribute, &element);
    if (error != kAXErrorSuccess || !element || CFGetTypeID(element) != AXUIElementGetTypeID()) {
        if (element) CFRelease(element);
        return Failure(@"NO_FOCUS", @"The focused element is unavailable.");
    }
    focus->element = (AXUIElementRef)element;
    AXUIElementSetMessagingTimeout(focus->element, 0.2f);
    pid_t elementPID = 0;
    if (AXUIElementGetPid(focus->element, &elementPID) != kAXErrorSuccess || elementPID != focus->pid || !FocusUnchanged(focus)) {
        return Failure(@"FOCUS_CHANGED", @"The focused application or element changed.");
    }
    return nil;
}

static NSDictionary *CheckNonsecure(AXUIElementRef element) {
    AXError error = kAXErrorSuccess;
    id subrole = CopyAttribute(element, kAXSubroleAttribute, &error);
    if (error != kAXErrorSuccess && error != kAXErrorAttributeUnsupported && error != kAXErrorNoValue) {
        return Failure(@"SECURITY_UNAVAILABLE", @"The focused element's security state is unavailable.");
    }
    if (subrole && ![subrole isKindOfClass:[NSString class]]) {
        return Failure(@"SECURITY_UNAVAILABLE", @"The focused element's security state is invalid.");
    }
    if ([subrole isEqualToString:(__bridge NSString *)kAXSecureTextFieldSubrole]) {
        return Failure(@"SECURE_TARGET", @"Secure text fields are not supported.");
    }
    NSArray<NSString *> *attributes = @[ NSAccessibilityContainsProtectedContentAttribute, @"AXProtectedContent", @"AXProtected", @"AXIsProtected" ];
    for (NSString *attribute in attributes) {
        id value = CopyAttribute(element, (__bridge CFStringRef)attribute, &error);
        if (error == kAXErrorAttributeUnsupported || error == kAXErrorNoValue) continue;
        if (error != kAXErrorSuccess || !value || CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID()) {
            return Failure(@"SECURITY_UNAVAILABLE", @"The focused element's security state is unavailable.");
        }
        if ([value boolValue]) return Failure(@"SECURE_TARGET", @"Protected text fields are not supported.");
    }
    return nil;
}

static NSDictionary *ReadSelection(const FocusSnapshot *focus) {
    NSDictionary *failure = CheckNonsecure(focus->element);
    if (failure) return failure;
    if (!FocusUnchanged(focus)) return Failure(@"FOCUS_CHANGED", @"The focused application or element changed.");
    AXError error = kAXErrorSuccess;
    id selected = CopyAttribute(focus->element, kAXSelectedTextAttribute, &error);
    if (error == kAXErrorAttributeUnsupported || error == kAXErrorNoValue) {
        // A range query returns only the selected text, never the full AXValue.
        CFTypeRef rangeValue = NULL;
        error = AXUIElementCopyAttributeValue(focus->element, kAXSelectedTextRangeAttribute, &rangeValue);
        CFRange range = CFRangeMake(0, 0);
        BOOL valid = error == kAXErrorSuccess && rangeValue && CFGetTypeID(rangeValue) == AXValueGetTypeID() && AXValueGetType((AXValueRef)rangeValue) == kAXValueCFRangeType && AXValueGetValue((AXValueRef)rangeValue, kAXValueCFRangeType, &range);
        if (!valid || range.location < 0 || range.length <= 0 || range.location > LONG_MAX - range.length) {
            if (rangeValue) CFRelease(rangeValue);
            return Failure(@"NO_SELECTION", @"No readable text selection is available.");
        }
        if ((NSUInteger)range.length > MaxTextBytes) {
            CFRelease(rangeValue);
            return Failure(@"SELECTION_TOO_LARGE", @"The selection exceeds 32 KiB.");
        }
        CFTypeRef text = NULL;
        error = AXUIElementCopyParameterizedAttributeValue(focus->element, kAXStringForRangeParameterizedAttribute, rangeValue, &text);
        CFRelease(rangeValue);
        selected = text ? CFBridgingRelease(text) : nil;
    }
    if (error != kAXErrorSuccess || ![selected isKindOfClass:[NSString class]] || [selected length] == 0) {
        return Failure(@"NO_SELECTION", @"No readable text selection is available.");
    }
    NSData *utf8 = [selected dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];
    if (!utf8) return Failure(@"INVALID_SELECTION", @"The selected text is not valid UTF-8.");
    if (utf8.length > MaxTextBytes) return Failure(@"SELECTION_TOO_LARGE", @"The selection exceeds 32 KiB.");
    failure = CheckNonsecure(focus->element);
    if (failure) return failure;
    if (!FocusUnchanged(focus)) return Failure(@"FOCUS_CHANGED", @"The focused application or element changed.");
    return @{ @"ok": @YES, @"text": selected };
}

static NSDictionary *CheckEditable(AXUIElementRef element) {
    NSDictionary *failure = CheckNonsecure(element);
    if (failure) return failure;
    id role = CopyAttribute(element, kAXRoleAttribute, NULL);
    if (![role isKindOfClass:[NSString class]]) return Failure(@"NOT_EDITABLE", @"The focused element is not a known editable target.");
    // Even a settable menu/button value is not a text paste target.
    NSSet<NSString *> *blocked = [NSSet setWithArray:@[ @"AXButton", @"AXPopUpButton", @"AXMenuButton", @"AXMenu", @"AXMenuItem", @"AXMenuBar", @"AXCheckBox", @"AXRadioButton", @"AXSlider", @"AXLink" ]];
    if ([blocked containsObject:role]) return Failure(@"NOT_EDITABLE", @"The focused element is not an editable text target.");
    id enabled = CopyAttribute(element, kAXEnabledAttribute, NULL);
    if (enabled && (![enabled isKindOfClass:[NSNumber class]] || ![enabled boolValue])) {
        return Failure(@"NOT_EDITABLE", @"The focused element is disabled.");
    }
    AXError editableError = kAXErrorSuccess;
    id editable = CopyAttribute(element, kAXIsEditableAttribute, &editableError);
    if (editableError == kAXErrorSuccess && (!editable || CFGetTypeID((__bridge CFTypeRef)editable) != CFBooleanGetTypeID() || ![editable boolValue])) {
        return Failure(@"NOT_EDITABLE", @"The focused element is not editable.");
    }
    Boolean valueSettable = false;
    BOOL settable = AXUIElementIsAttributeSettable(element, kAXValueAttribute, &valueSettable) == kAXErrorSuccess && valueSettable;
    BOOL textRole = [role isEqualToString:(__bridge NSString *)kAXTextFieldRole] || [role isEqualToString:(__bridge NSString *)kAXTextAreaRole] || [role isEqualToString:@"AXComboBox"];
    BOOL editableWebRole = [@[ @"AXWebArea", @"AXGroup", @"AXText", @"AXStaticText" ] containsObject:role] && editableError == kAXErrorSuccess && [editable boolValue];
    if (!settable && !textRole && !editableWebRole) return Failure(@"NOT_EDITABLE", @"The focused element is not a known editable text target.");
    return nil;
}

static BOOL PhysicalKeysReleased(void) {
    CGEventFlags flags = CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState);
    CGEventFlags modifiers = kCGEventFlagMaskShift | kCGEventFlagMaskControl | kCGEventFlagMaskAlternate | kCGEventFlagMaskCommand | kCGEventFlagMaskSecondaryFn;
    if (flags & modifiers) return NO;
    for (CGKeyCode key = 0; key < 128; key++) {
        if (CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, key)) return NO;
    }
    return YES;
}

static NSDictionary *Paste(const FocusSnapshot *focus) {
    NSDictionary *failure = CheckEditable(focus->element);
    if (failure) return failure;
    NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
    NSInteger changeCount = pasteboard.changeCount;
    NSString *text = [pasteboard stringForType:NSPasteboardTypeString];
    if (![text isKindOfClass:[NSString class]] || text.length == 0) {
        return Failure(@"NO_CLIPBOARD_TEXT", @"The clipboard does not contain nonempty plain text.");
    }
    if (pasteboard.changeCount != changeCount) return Failure(@"CLIPBOARD_CHANGED", @"The clipboard changed before paste.");
    CFTimeInterval deadline = [NSProcessInfo processInfo].systemUptime + 1.0;
    while (!PhysicalKeysReleased()) {
        if ([NSProcessInfo processInfo].systemUptime >= deadline) return Failure(@"KEYS_HELD", @"Release all keys and modifiers before pasting.");
        usleep(10000);
    }
    failure = CheckEditable(focus->element);
    if (failure) return failure;
    if (!Trusted(NO)) return Failure(@"NOT_TRUSTED", @"Accessibility permission is required.");
    if (!FocusUnchanged(focus)) return Failure(@"FOCUS_CHANGED", @"The focused application or element changed.");
    if (pasteboard.changeCount != changeCount) return Failure(@"CLIPBOARD_CHANGED", @"The clipboard changed before paste.");
    if (!PhysicalKeysReleased()) return Failure(@"KEYS_HELD", @"Release all keys and modifiers before pasting.");
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStatePrivate);
    CGEventRef down = source ? CGEventCreateKeyboardEvent(source, 9, true) : NULL; // ANSI V
    CGEventRef up = source ? CGEventCreateKeyboardEvent(source, 9, false) : NULL;
    if (!down || !up) {
        if (down) CFRelease(down);
        if (up) CFRelease(up);
        if (source) CFRelease(source);
        return Failure(@"EVENT_UNAVAILABLE", @"The paste key events could not be created.");
    }
    CGEventSetFlags(down, kCGEventFlagMaskCommand);
    CGEventSetFlags(up, kCGEventFlagMaskCommand);
    // Recheck after allocation, immediately before the only two posted events.
    BOOL sameFocus = FocusUnchanged(focus);
    BOOL sameClipboard = pasteboard.changeCount == changeCount;
    BOOL released = PhysicalKeysReleased();
    if (sameFocus && sameClipboard && released) {
        CGEventPost(kCGHIDEventTap, down);
        CGEventPost(kCGHIDEventTap, up);
    }
    CFRelease(down);
    CFRelease(up);
    CFRelease(source);
    if (!sameFocus) return Failure(@"FOCUS_CHANGED", @"The focused application or element changed.");
    if (!sameClipboard) return Failure(@"CLIPBOARD_CHANGED", @"The clipboard changed before paste.");
    if (!released) return Failure(@"KEYS_HELD", @"Release all keys and modifiers before pasting.");
    // Success means the single Cmd+V pair was posted, not that the target accepted it.
    return @{ @"ok": @YES };
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) {
            Emit(Failure(@"INVALID_COMMAND", @"Exactly one supported command is required."));
            return 0;
        }
        NSString *command = [NSString stringWithUTF8String:argv[1]];
        if ([command isEqualToString:@"status"] || [command isEqualToString:@"request"]) {
            Emit(@{ @"supported": @YES, @"trusted": @(Trusted([command isEqualToString:@"request"])) });
            return 0;
        }
        if (![command isEqualToString:@"selection"] && ![command isEqualToString:@"paste"]) {
            Emit(Failure(@"INVALID_COMMAND", @"The command is not supported."));
            return 0;
        }
        if (!Trusted(NO)) {
            Emit(Failure(@"NOT_TRUSTED", @"Accessibility permission is required."));
            return 0;
        }
        FocusSnapshot focus = {0};
        NSDictionary *result = CaptureFocus(&focus);
        if (!result) result = [command isEqualToString:@"selection"] ? ReadSelection(&focus) : Paste(&focus);
        ReleaseFocus(&focus);
        Emit(result);
    }
    return 0;
}
