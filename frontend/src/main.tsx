import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Apply dark mode before first render to prevent flash
const isDark = localStorage.getItem('pp-theme') === 'dark'
  || (!localStorage.getItem('pp-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
if (isDark) document.documentElement.classList.add('dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
