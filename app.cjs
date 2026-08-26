// cPanel / CloudLinux Passenger compatibility wrapper for an ESM application.
// Passenger loads this CommonJS file, which then dynamically imports the ESM server.
(() => import('./server/index.js'))();
