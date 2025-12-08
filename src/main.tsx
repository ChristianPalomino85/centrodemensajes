import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import DetachedChatPage from './DetachedChatPage'
import { ThemeProvider } from './components/ThemeProvider'

// Check if we're in detached chat mode
const urlParams = new URLSearchParams(window.location.search);
const isDetachedMode = urlParams.get('mode') === 'detached';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="contact-center-theme">
      {isDetachedMode ? <DetachedChatPage /> : <App />}
    </ThemeProvider>
  </React.StrictMode>,
)