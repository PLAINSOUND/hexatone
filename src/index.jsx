import { h, render } from 'preact';
import {options} from 'preact';
import PropTypes from 'prop-types';
import App from './app.jsx';

if (process.env.NODE_ENV !== "production") {
  // installs global prop type checking for app preact components
  options.vnode = vnode => {
    let Component = vnode.type;
    if (Component && Component.propTypes) {
      PropTypes.checkPropTypes(
        Component.propTypes,
        vnode.props
      );
    }
  };
}

// ── Version tracking for cache busting ─────────────────────────────────────
// Increment this version for each release to force cache refresh
const APP_VERSION = '3.1.0_beta';

// Check stored version and force reload if mismatch
const storedVersion = localStorage.getItem('hexatone_version');
if (storedVersion && storedVersion !== APP_VERSION) {
  console.log(`Version changed: ${storedVersion} → ${APP_VERSION}, clearing caches...`);
  
  // Clear all caches
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(name => caches.delete(name));
    });
  }
  
  // Unregister any service workers
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(reg => reg.unregister());
    });
  }
  
  // Update stored version and reload
  localStorage.setItem('hexatone_version', APP_VERSION);
  window.location.reload();
} else {
  // Store current version
  localStorage.setItem('hexatone_version', APP_VERSION);
}

// ── Register service worker (production only) ──────────────────────────────
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('Service Worker registered:', reg.scope);
      
      // Check for updates on page load
      reg.update();
      
      // When a new SW is waiting, force it to activate
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      
      // When a new SW activates, reload the page
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('New version available, reloading...');
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(err => {
      console.warn('Service Worker registration failed:', err);
    });
    
    // Reload when controller changes (new SW took over)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  });
}

render(<App />, document.getElementById('application'));