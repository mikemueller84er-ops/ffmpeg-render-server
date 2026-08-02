const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
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

  const args = [
    '-i', inputPath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '28',
    '-threads', '1',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-y', outputPath
  ];

  const ffmpeg = spawn('ffmpeg', args);

  let errorOutput = '';
  ffmpeg.stderr.on('data', (data) => { errorOutput += data.toString(); });

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      console.error('FFmpeg-Fehler (Code ' + code + '):', errorOutput);
      return res.status(500).json({ error: 'FFmpeg fehlgeschlagen', code, details: errorOutput });
    }
    res.download(outputPath, 'output.mp4', () => {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
    });
  });
});

app.get('/', (req, res) => res.send('FFmpeg Render Server läuft'));

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
