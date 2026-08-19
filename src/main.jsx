import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DialRoot } from 'dialkit';
import 'dialkit/styles.css';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <DialRoot />
  </StrictMode>,
);
