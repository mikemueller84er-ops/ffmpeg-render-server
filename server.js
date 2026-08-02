const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

app.post('/process', upload.single('video'), (req, res) => {
  console.log('Anfrage erhalten. Body:', req.body, 'File:', req.file);

  if (!req.file) {
    console.error('FEHLER: Keine Datei im Feld "video" empfangen.');
    return res.status(400).json({ error: 'Keine Videodatei im Feld "video" gefunden.' });
  }

  const inputPath = req.file.path;
  const outputPath = `${inputPath}_output.mp4`;

  const command = `ffmpeg -i "${inputPath}" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -y "${outputPath}"`;

  try {
    execSync(command);
    res.download(outputPath, 'output.mp4', () => {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
    });
  } catch (error) {
    console.error('FEHLER:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => res.send('FFmpeg Render Server läuft'));

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
