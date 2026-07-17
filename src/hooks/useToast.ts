import { useState } from "react"
import { ToastVariant, ToastMessage } from "../components/ui/toast"

export function useToast() {
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<ToastMessage>({
    title: "",
    description: "",
    variant: "neutral",
  })

  const showToast = (title: string, description: string, variant: ToastVariant) => {
    setToastMessage({ title, description, variant })
    setToastOpen(true)
  }

  return { toastOpen, setToastOpen, toastMessage, showToast }
}
