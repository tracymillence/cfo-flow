require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const connectDB = require('./src/config/db');
const seedDatabase = require('./src/seed');
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files (Serve public/ directory and root for backwards compatibility)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Mount REST API
app.use('/api', apiRoutes);

// Fallback all other GET routes to Single Page App
app.get('*', (req, res) => {
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  res.sendFile(publicIndex);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 CFO Flow Server is running on port ${PORT}`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`📱 Public SPA directory: /public/index.html`);
  console.log(`📊 REST API: http://localhost:${PORT}/api/dining/summary`);
  console.log(`=======================================================`);

  // Connect to MongoDB asynchronously without blocking port binding
  connectDB().then(async (conn) => {
    if (conn) {
      try {
        await seedDatabase(false);
      } catch (e) {
        console.warn('Seed warning:', e.message);
      }
    }
  });
});
