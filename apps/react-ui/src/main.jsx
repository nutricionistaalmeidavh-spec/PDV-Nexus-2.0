import React from 'react';
import {createRoot} from 'react-dom/client';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import {NexusTheme} from './NexusTheme.jsx';
import App from './App.jsx';
import './theme.css';
import './nexus-pos.css';
createRoot(document.getElementById('root')).render(<NexusTheme><App/></NexusTheme>);
