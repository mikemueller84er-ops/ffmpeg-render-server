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

  const probeArgs = ['-i', inputPath, '-f', 'null', '-'];
  const probe = spawn('ffmpeg', probeArgs);
  let probeOutput = '';
  probe.stderr.on('data', (data) => { probeOutput += data.toString(); });

  probe.on('close', () => {
    const durationMatch = probeOutput.match(/Duration:\s*(\d+):(\d+):(\d+(\.\d+)?)/);
    let totalDuration = 0;
    if (durationMatch) {
      totalDuration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseFloat(durationMatch[3]);
    }

    if (totalDuration <= 90) {
      console.log(`Video ist ${totalDuration}s lang – keine Kürzung nötig.`);
      const outputPath = `${inputPath}_trimmed.mp4`;
      const copyArgs = ['-i', inputPath, '-c', 'copy', '-y', outputPath];
      const copy = spawn('ffmpeg', copyArgs);
      copy.on('close', (code) => {
        fs.unlinkSync(inputPath);
        if (code !== 0) {
          return res.status(500).json({ error: 'Trim (Kopie) fehlgeschlagen' });
        }
        res.download(outputPath, 'trimmed.mp4', () => fs.unlinkSync(outputPath));
      });
      return;
    }

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

      const clipLength = Math.min(75, totalDuration - startTime);

      const outputPath = `${inputPath}_trimmed.mp4`;
      // Stream-Copy statt Neuencodierung – deutlich schneller
      const trimArgs = [
        '-ss', startTime.toString(),
        '-i', inputPath,
        '-t', clipLength.toString(),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
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
        res.download(outputPath, 'trimmed.mp4', () => fs.unlinkSync(outputPath));
      });
    });
  });
});
app.post('/extract-frames', upload.single('video'), (req, res) => {
  console.log('Frame-Extraktion angefragt. File:', req.file);

  if (!req.file) {
    return res.status(400).json({ error: 'Keine Videodatei im Feld "video" gefunden.' });
  }

  const inputPath = req.file.path;
  const framesDir = `${inputPath}_frames`;
  fs.mkdirSync(framesDir);

  const args = [
    '-i', inputPath,
    '-vf', 'fps=1/2',
    '-q:v', '5',
    `${framesDir}/frame_%03d.jpg`
  ];

  const ffmpeg = spawn('ffmpeg', args);
  let errorOutput = '';
  ffmpeg.stderr.on('data', (data) => { errorOutput += data.toString(); });

  ffmpeg.on('close', (code) => {
    fs.unlinkSync(inputPath);

    if (code !== 0) {
      console.error('FFmpeg-Frame-Fehler:', errorOutput);
      return res.status(500).json({ error: 'Frame-Extraktion fehlgeschlagen', details: errorOutput });
    }

    const files = fs.readdirSync(framesDir).sort();
    const frames = files.map((filename, index) => {
      const filePath = `${framesDir}/${filename}`;
      const base64 = fs.readFileSync(filePath).toString('base64');
      fs.unlinkSync(filePath);
      return {
        timestamp: index * 2,
        base64: base64
      };
    });
    fs.rmdirSync(framesDir);

    res.json({ frames: frames, count: frames.length });
  });
});
app.post('/thumbnail', upload.single('video'), (req, res) => {
  console.log('Thumbnail-Anfrage erhalten. File:', req.file, 'Body:', req.body);

  if (!req.file) {
    return res.status(400).json({ error: 'Keine Videodatei im Feld "video" gefunden.' });
  }

  const inputPath = req.file.path;
  const outputPath = `${inputPath}_thumb.jpg`;
  const second = req.body.second ? parseFloat(req.body.second) : 1;

  const args = [
    '-ss', second.toString(),
    '-i', inputPath,
    '-vframes', '1',
    '-q:v', '2',
    '-y', outputPath
  ];

  const ffmpeg = spawn('ffmpeg', args);

  let errorOutput = '';
  ffmpeg.stderr.on('data', (data) => { errorOutput += data.toString(); });

  ffmpeg.on('close', (code) => {
    fs.unlinkSync(inputPath);

    if (code !== 0) {
      console.error('FFmpeg-Thumbnail-Fehler (Code ' + code + '):', errorOutput);
      return res.status(500).json({ error: 'Thumbnail-Erstellung fehlgeschlagen', code, details: errorOutput });
    }
    res.download(outputPath, 'thumbnail.jpg', () => {
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
