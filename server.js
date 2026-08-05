const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
const upload = multer({ dest: 'uploads/' });
const uploadMultiple = multer({ dest: 'uploads/' });

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
    '-crf', '22',
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

app.post('/merge', uploadMultiple.array('videos'), (req, res) => {
  console.log('Merge-Anfrage erhalten. Anzahl Dateien:', req.files ? req.files.length : 0);

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Keine Videodateien im Feld "videos" gefunden.' });
  }

  const listPath = `uploads/concat_list_${Date.now()}.txt`;
  const listContent = req.files.map(f => `file '${path.resolve(f.path)}'`).join('\n');
  fs.writeFileSync(listPath, listContent);

  const outputPath = `uploads/merged_${Date.now()}.mp4`;

  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-y', outputPath
  ];

  const ffmpeg = spawn('ffmpeg', args);

  let errorOutput = '';
  ffmpeg.stderr.on('data', (data) => { errorOutput += data.toString(); });

  ffmpeg.on('close', (code) => {
    req.files.forEach(f => fs.unlinkSync(f.path));
    fs.unlinkSync(listPath);

    if (code !== 0) {
      console.error('FFmpeg-Merge-Fehler (Code ' + code + '):', errorOutput);
      return res.status(500).json({ error: 'FFmpeg-Merge fehlgeschlagen', code, details: errorOutput });
    }
    res.download(outputPath, 'merged.mp4', () => {
      fs.unlinkSync(outputPath);
    });
  });
});
app.post('/trim', upload.single('video'), (req, res) => {
  console.log('Trim-Anfrage erhalten. File:', req.file);

  if (!req.file) {
    return res.status(400).json({ error: 'Keine Videodatei im Feld "video" gefunden.' });
  }

  const inputPath = req.file.path;

  const detectArgs = [
    '-i', inputPath,
    '-vf', "select='gt(scene,0.3)',metadata=print",
    '-an', '-f', 'null',
    '-t', '120',
    '-'
  ];

  const detect = spawn('ffmpeg', detectArgs);
  let sceneOutput = '';
  detect.stderr.on('data', (data) => { sceneOutput += data.toString(); });

  detect.on('close', () => {
    const timeMatches = [...sceneOutput.matchAll(/pts_time:([0-9.]+)/g)].map(m => parseFloat(m[1]));

    let startTime = 0;
    if (timeMatches.length > 0) {
      startTime = timeMatches[Math.floor(timeMatches.length / 2)];
      startTime = Math.max(0, startTime - 5);
    }

    const outputPath = `${inputPath}_trimmed.mp4`;
    const trimArgs = [
      '-i', inputPath,
      '-ss', startTime.toString(),
      '-t', '75',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '22',
      '-c:a', 'aac',
      '-y', outputPath
    ];

    const trim = spawn('ffmpeg', trimArgs);
    let trimError = '';
    trim.stderr.on('data', (data) => { trimError += data.toString(); });

    trim.on('close', (code) => {
      fs.unlinkSync(inputPath);
      if (code !== 0) {
        console.error('FFmpeg-Trim-Fehler:', trimError);
        return res.status(500).json({ error: 'Trim fehlgeschlagen', details: trimError });
      }
      res.download(outputPath, 'trimmed.mp4', () => {
        fs.unlinkSync(outputPath);
      });
    });
  });
});
app.get('/', (req, res) => res.send('FFmpeg Render Server läuft'));

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
