const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const decoderLatin1 = new TextDecoder('latin1');
const root = path.join(__dirname, '..', 'views');
const files = fs.readdirSync(root).filter((f) => f.endsWith('.ejs'));

let fixed = 0;
for (const file of files) {
  const filePath = path.join(root, file);
  const buf = fs.readFileSync(filePath);
  const utf8Text = buf.toString('utf8');
  if (/�|�|?/.test(utf8Text)) {
    const repaired = decoderLatin1.decode(buf);
    fs.writeFileSync(filePath, repaired, 'utf8');
    fixed++;
    console.log(`Repaired encoding: ${file}`);
  }
}
console.log(`Done. Repaired ${fixed} file(s).`);
