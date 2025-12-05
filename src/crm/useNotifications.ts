import { useEffect, useRef } from "react";
import type { Message } from "./types";

interface NotificationOptions {
  enabled: boolean;
  showPreview: boolean;
}

export function useNotifications(messages: Message[], options: NotificationOptions) {
  const previousMessagesRef = useRef<Set<string>>(new Set());
  const permissionGrantedRef = useRef(false);

  // Request notification permission on mount if enabled
  useEffect(() => {
    if (options.enabled && "Notification" in window) {
      if (Notification.permission === "granted") {
        permissionGrantedRef.current = true;
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((permission) => {
          if (permission === "granted") {
            permissionGrantedRef.current = true;
          }
        });
      }
    }
  }, [options.enabled]);

  // Detect new messages and show notifications
  useEffect(() => {
    if (!options.enabled || !permissionGrantedRef.current) return;

    const currentMessageIds = new Set(messages.map((m) => m.id));
    const previousIds = previousMessagesRef.current;

    // Find new messages (messages in current but not in previous)
    const newMessages = messages.filter(
      (msg) => !previousIds.has(msg.id) && msg.direction === "incoming"
    );

    // Show notification for each new incoming message
    newMessages.forEach((msg) => {
      const title = "Nuevo mensaje";
      const body = options.showPreview
        ? msg.text || "Mensaje multimedia"
        : "Tienes un nuevo mensaje";

      const notification = new Notification(title, {
        body,
        icon: "/favicon.svg",
        badge: "/favicon.svg",
        tag: msg.id, // Prevent duplicate notifications
        requireInteraction: false,
      });

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);

      // Focus window when notification is clicked
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    });

    // Update previous messages set
    previousMessagesRef.current = currentMessageIds;
  }, [messages, options.enabled, options.showPreview]);
}
