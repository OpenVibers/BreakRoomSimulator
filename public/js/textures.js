// Procedural canvas textures — every visual asset is drawn in code (no downloads).
import * as THREE from 'three';

export function ct(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
  t.canvas = c; t.ctx = g;
  return t;
}

// ---------- polished concrete floor ----------
export function concreteTexture() {
  return ct(1024, 1024, (g, w, h) => {
    g.fillStyle = '#6a6d70'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = Math.random() * 26 + 3;
      const v = 96 + Math.random() * 34;
      g.fillStyle = `rgba(${v},${v + 2},${v + 5},${Math.random() * .11})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 60; i++) { // darker stains
      const x = Math.random() * w, y = Math.random() * h, r = Math.random() * 70 + 20;
      g.fillStyle = `rgba(40,42,46,${Math.random() * .08})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // saw-cut control joints
    g.strokeStyle = 'rgba(50,52,55,.55)'; g.lineWidth = 3;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo((w / 4) * i, 0); g.lineTo((w / 4) * i, h); g.stroke();
      g.beginPath(); g.moveTo(0, (h / 4) * i); g.lineTo(w, (h / 4) * i); g.stroke();
    }
  }, { repeat: [7, 3.2] });
}

export function asphaltTexture() {
  return ct(512, 512, (g, w, h) => {
    g.fillStyle = '#3c3f43'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      const v = 45 + Math.random() * 40;
      g.fillStyle = `rgb(${v},${v},${v + 3})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, { repeat: [30, 30] });
}

export function woodTexture(base = '#a8967e', dark = '#8a7861') {
  return ct(512, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 7 + Math.random() * 9) {
      g.strokeStyle = `rgba(90,74,56,${.12 + Math.random() * .22})`;
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * .02 + y) * 2.5);
      g.stroke();
    }
    g.fillStyle = dark + '22'; g.fillRect(0, 0, w, h);
  });
}

// ---------- flags (simplified but recognizable) ----------
function star(g, x, y, r, color) {
  g.fillStyle = color; g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r;
    g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}
const FLAG_PAINTERS = {
  usa(g, w, h) {
    for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#fff' : '#B22234'; g.fillRect(0, i * h / 13, w, h / 13 + 1); }
    g.fillStyle = '#3C3B6E'; g.fillRect(0, 0, w * .42, h * 7 / 13);
    g.fillStyle = '#fff';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) star(g, w * .04 + c * w * .068 + (r % 2) * w * .034, h * .05 + r * h * .09, w * .016, '#fff');
  },
  brazil(g, w, h) {
    g.fillStyle = '#009C3B'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#FFDF00'; g.beginPath();
    g.moveTo(w * .5, h * .1); g.lineTo(w * .9, h * .5); g.lineTo(w * .5, h * .9); g.lineTo(w * .1, h * .5); g.closePath(); g.fill();
    g.fillStyle = '#002776'; g.beginPath(); g.arc(w * .5, h * .5, h * .27, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = h * .05;
    g.beginPath(); g.arc(w * .5, h * .78, h * .48, -2.3, -0.85); g.stroke();
  },
  finland(g, w, h) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#003580';
    g.fillRect(0, h * .4, w, h * .22); g.fillRect(w * .28, 0, w * .16, h);
  },
  nepal(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#DC143C'; g.strokeStyle = '#003893'; g.lineWidth = w * .06;
    g.beginPath(); g.moveTo(w * .1, h * .04); g.lineTo(w * .82, h * .30); g.lineTo(w * .35, h * .42);
    g.lineTo(w * .95, h * .72); g.lineTo(w * .1, h * .96); g.closePath(); g.fill(); g.stroke();
    star(g, w * .32, h * .68, w * .1, '#fff');
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w * .32, h * .23, w * .09, 0, 7); g.fill();
  },
  haiti(g, w, h) {
    g.fillStyle = '#00209F'; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#D21034'; g.fillRect(0, h / 2, w, h / 2);
    g.fillStyle = '#fff'; g.fillRect(w * .36, h * .3, w * .28, h * .4);
    g.fillStyle = '#3a7d44'; g.fillRect(w * .42, h * .42, w * .16, h * .2);
  },
  elsalvador(g, w, h) {
    g.fillStyle = '#0F47AF'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.fillRect(0, h / 3, w, h / 3);
    g.fillStyle = '#FCD116'; g.beginPath(); g.arc(w / 2, h / 2, h * .12, 0, 7); g.fill();
  },
  puertorico(g, w, h) {
    for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#fff' : '#EF3340'; g.fillRect(0, i * h / 5, w, h / 5 + 1); }
    g.fillStyle = '#0050F0'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w * .45, h / 2); g.lineTo(0, h); g.closePath(); g.fill();
    star(g, w * .14, h * .5, h * .14, '#fff');
  },
  spain(g, w, h) {
    g.fillStyle = '#AA151B'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#F1BF00'; g.fillRect(0, h * .25, w, h * .5);
    g.fillStyle = '#AA151B'; g.fillRect(w * .22, h * .38, w * .1, h * .24);
  },
  scotland(g, w, h) {
    g.fillStyle = '#005EB8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = h * .18;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
  },
  australia(g, w, h) {
    g.fillStyle = '#00247D'; g.fillRect(0, 0, w, h);
    // union jack canton
    g.strokeStyle = '#fff'; g.lineWidth = h * .09;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w * .45, h * .5); g.moveTo(w * .45, 0); g.lineTo(0, h * .5); g.stroke();
    g.strokeStyle = '#CF142B'; g.lineWidth = h * .045;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w * .45, h * .5); g.moveTo(w * .45, 0); g.lineTo(0, h * .5); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = h * .16;
    g.beginPath(); g.moveTo(w * .225, 0); g.lineTo(w * .225, h * .5); g.moveTo(0, h * .25); g.lineTo(w * .45, h * .25); g.stroke();
    g.strokeStyle = '#CF142B'; g.lineWidth = h * .08;
    g.beginPath(); g.moveTo(w * .225, 0); g.lineTo(w * .225, h * .5); g.moveTo(0, h * .25); g.lineTo(w * .45, h * .25); g.stroke();
    star(g, w * .22, h * .75, h * .1, '#fff');
    star(g, w * .75, h * .2, h * .07, '#fff'); star(g, w * .85, h * .45, h * .07, '#fff');
    star(g, w * .68, h * .55, h * .05, '#fff'); star(g, w * .78, h * .78, h * .07, '#fff');
  },
  ethiopia(g, w, h) {
    g.fillStyle = '#078930'; g.fillRect(0, 0, w, h / 3);
    g.fillStyle = '#FCDD09'; g.fillRect(0, h / 3, w, h / 3);
    g.fillStyle = '#DA121A'; g.fillRect(0, 2 * h / 3, w, h / 3);
    g.fillStyle = '#0F47AF'; g.beginPath(); g.arc(w / 2, h / 2, h * .22, 0, 7); g.fill();
    star(g, w / 2, h / 2, h * .15, '#FCDD09');
  },
  nigeria(g, w, h) {
    g.fillStyle = '#008751'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.fillRect(w / 3, 0, w / 3, h);
  },
  fiji(g, w, h) {
    g.fillStyle = '#68BFE5'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#00247D'; g.fillRect(0, 0, w * .4, h * .45);
    g.strokeStyle = '#fff'; g.lineWidth = h * .06;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w * .4, h * .45); g.moveTo(w * .4, 0); g.lineTo(0, h * .45); g.stroke();
    g.fillStyle = '#fff'; g.fillRect(w * .62, h * .3, w * .22, h * .42);
    g.fillStyle = '#DA121A'; g.fillRect(w * .62, h * .3, w * .22, h * .08);
  },
  venezuela(g, w, h) {
    g.fillStyle = '#FCE300'; g.fillRect(0, 0, w, h / 3);
    g.fillStyle = '#003DA5'; g.fillRect(0, h / 3, w, h / 3);
    g.fillStyle = '#CF142B'; g.fillRect(0, 2 * h / 3, w, h / 3);
    for (let i = 0; i < 8; i++) star(g, w / 2 + Math.cos(Math.PI * (1 + i / 7)) * w * .18, h * .52 + Math.sin(Math.PI * (1 + i / 7)) * h * .22, h * .05, '#fff');
  },
  kyrgyzstan(g, w, h) {
    g.fillStyle = '#EF3340'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#FFDD00'; g.beginPath(); g.arc(w / 2, h / 2, h * .28, 0, 7); g.fill();
    g.strokeStyle = '#EF3340'; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      g.beginPath(); g.arc(w / 2, h / 2, h * .22, i, i + .35); g.stroke();
    }
  },
  mexico(g, w, h) {
    g.fillStyle = '#006847'; g.fillRect(0, 0, w / 3, h);
    g.fillStyle = '#fff'; g.fillRect(w / 3, 0, w / 3, h);
    g.fillStyle = '#CE1126'; g.fillRect(2 * w / 3, 0, w / 3, h);
    g.fillStyle = '#8a6d3b'; g.beginPath(); g.arc(w / 2, h / 2, h * .13, 0, 7); g.fill();
  },
  pride(g, w, h) {
    const cs = ['#E40303', '#FF8C00', '#FFED00', '#008026', '#24408E', '#732982'];
    cs.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * h / 6, w, h / 6 + 1); });
  },
};
export const FLAG_NAMES = Object.keys(FLAG_PAINTERS);
export function flagTexture(name) {
  return ct(256, 160, (g, w, h) => {
    (FLAG_PAINTERS[name] || FLAG_PAINTERS.usa)(g, w, h);
    // subtle fabric shading
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(0,0,0,.12)'); gr.addColorStop(.5, 'rgba(255,255,255,.05)'); gr.addColorStop(1, 'rgba(0,0,0,.18)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

// ---------- signage ----------
export function avenueCTexture() {
  return ct(1024, 160, (g, w, h) => {
    g.fillStyle = '#2b2b2e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8e4dc'; g.font = '600 74px "Segoe UI", sans-serif'; g.textBaseline = 'middle';
    g.fillText('avenue', w * .30, h * .52);
    g.fillStyle = '#f90'; g.font = '800 90px "Segoe UI", sans-serif';
    g.fillText('C', w * .56, h * .52);
  });
}
export function togetherBannerTexture() {
  return ct(256, 640, (g, w, h) => {
    g.fillStyle = '#f7f6f4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff6200'; g.font = '700 34px "Segoe UI", sans-serif';
    g.fillText('Together', 22, 52);
    g.fillStyle = '#232f3e'; g.font = '600 22px "Segoe UI", sans-serif';
    g.fillText('at amazon', 22, 82);
    g.fillStyle = '#555'; g.font = '12px sans-serif';
    g.fillText('Helping employees grow, thrive,', 22, 112);
    g.fillText('and connect as we are', 22, 128);
    g.fillText('future-ready together.', 22, 144);
    const blocks = [['#3e6990', 170], ['#b86125', 320], ['#6a8f5f', 470]];
    for (const [color, y] of blocks) {
      g.fillStyle = color; g.fillRect(22, y, w - 44, 130);
      g.fillStyle = 'rgba(255,255,255,.25)';
      g.beginPath(); g.arc(w / 2, y + 55, 26, 0, 7); g.fill();
      g.fillStyle = '#d9e2ec'; g.fillRect(w / 2 - 30, y + 84, 60, 34);
    }
  });
}
export function newsletterTexture() {
  return ct(128, 160, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff5da2'; g.font = '700 16px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('JULY', w / 2, 26); g.fillText('NEWSLETTER', w / 2, 44);
    g.fillStyle = '#f2a521'; g.beginPath(); g.arc(w / 2, 62, 8, 0, 7); g.fill();
    g.fillStyle = '#888'; g.textAlign = 'left';
    for (let y = 80; y < h - 10; y += 9) g.fillRect(12, y, w - 24 - Math.random() * 30, 3);
  });
}
export function stackDecal(label) {
  return ct(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f5f3ee'; g.fillRect(w * .18, h * .3, w * .64, h * .4);
    g.fillStyle = '#111'; g.font = '700 34px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, w / 2, h * .5);
  });
}

// ---------- machines ----------
export function vendingTexture(kind) { // 'pepsi' | 'snack'
  return ct(256, 512, (g, w, h) => {
    g.fillStyle = kind === 'pepsi' ? '#0e3a8c' : '#3d3f45'; g.fillRect(0, 0, w, h);
    // glass window
    g.fillStyle = '#101821'; g.fillRect(18, 26, w - 70, h - 130);
    const rows = 6, cols = 5;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = 26 + c * ((w - 86) / cols), y = 40 + r * ((h - 160) / rows);
      g.fillStyle = ['#e33', '#3ae', '#fb3', '#6d4', '#e7e', '#f80', '#9cf'][Math.floor(Math.random() * 7)];
      if (kind === 'pepsi') { g.fillRect(x, y + 14, 22, 40); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + 3, y + 18, 5, 32); }
      else { g.beginPath(); g.moveTo(x, y + 50); g.quadraticCurveTo(x + 13, y - 4, x + 26, y + 50); g.closePath(); g.fill(); }
      g.fillStyle = '#aaa'; g.fillRect(x - 3, y + 54, 30, 3);
    }
    // side rail + keypad
    g.fillStyle = kind === 'pepsi' ? '#0a2c69' : '#2c2e33'; g.fillRect(w - 48, 0, 48, h);
    g.fillStyle = '#181c22'; g.fillRect(w - 40, 60, 32, 70);
    g.fillStyle = '#2de'; g.fillRect(w - 38, 66, 28, 12);
    for (let i = 0; i < 9; i++) { g.fillStyle = '#666'; g.fillRect(w - 38 + (i % 3) * 10, 86 + Math.floor(i / 3) * 12, 8, 8); }
    g.fillStyle = '#111'; g.fillRect(20, h - 90, w - 88, 60); // pickup flap
    g.fillStyle = '#333'; g.fillRect(26, h - 84, w - 100, 48);
    if (kind === 'pepsi') {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(w * .38, h - 106, 14, 0, 7); g.fill();
      g.fillStyle = '#d32'; g.beginPath(); g.arc(w * .38, h - 106, 14, -Math.PI, -0.2); g.fill();
      g.fillStyle = '#0e3a8c'; g.beginPath(); g.arc(w * .38, h - 106, 14, .6, 2.4); g.fill();
    }
  });
}
export function coolerTexture(kind) { // 'drinks' | 'food' | 'redbull'
  return ct(256, 512, (g, w, h) => {
    g.fillStyle = kind === 'redbull' ? '#16233d' : '#191b1e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0c1218'; g.fillRect(14, 60, w - 28, h - 100);
    const rows = kind === 'food' ? 5 : 6;
    for (let r = 0; r < rows; r++) {
      const y = 74 + r * ((h - 130) / rows);
      for (let c = 0; c < 7; c++) {
        const x = 22 + c * ((w - 50) / 7);
        if (kind === 'food') {
          g.fillStyle = ['#cfe0cf', '#e8d9c2', '#dfcfe4', '#cdd9ea'][Math.floor(Math.random() * 4)];
          g.fillRect(x, y + 10, 26, 24);
          g.fillStyle = '#7a8'; g.fillRect(x + 3, y + 13, 20, 8);
        } else {
          g.fillStyle = ['#e63', '#3ae', '#fb3', '#6d4', '#a5f', '#f45', '#4ec'][Math.floor(Math.random() * 7)];
          g.fillRect(x + 4, y + 8, 16, 34);
          g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(x + 6, y + 10, 4, 30);
        }
      }
      g.fillStyle = '#96a0ab'; g.fillRect(18, y + 44, w - 36, 3);
    }
    // lit header
    g.fillStyle = kind === 'redbull' ? '#dce8ff' : '#e9f2fa'; g.fillRect(14, 14, w - 28, 38);
    g.font = '700 22px "Segoe UI", sans-serif'; g.textAlign = 'center';
    if (kind === 'redbull') { g.fillStyle = '#1c3fa0'; g.fillText('Red Bull', w / 2, 40); }
    else { g.fillStyle = '#666'; g.fillText('avenue C', w / 2, 40); }
    // glass reflection + door frame
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, 'rgba(255,255,255,.16)'); gr.addColorStop(.25, 'rgba(255,255,255,0)');
    gr.addColorStop(.8, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,.1)');
    g.fillStyle = gr; g.fillRect(14, 60, w - 28, h - 100);
    g.strokeStyle = '#000'; g.lineWidth = 6; g.strokeRect(10, 56, w - 20, h - 92);
    g.fillStyle = '#c9ced4'; g.fillRect(w - 26, h * .35, 8, h * .3); // handle
  });
}
export function snackWallTexture() {
  return ct(512, 512, (g, w, h) => {
    g.fillStyle = '#8f8577'; g.fillRect(0, 0, w, h); // slatwall
    g.strokeStyle = 'rgba(60,52,40,.5)'; g.lineWidth = 2;
    for (let y = 0; y < h; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let r = 0; r < 5; r++) {
      const y = 30 + r * 95;
      for (let c = 0; c < 8; c++) {
        const x = 16 + c * 62;
        g.fillStyle = ['#f3d117', '#e2262d', '#2a9134', '#f26f21', '#8c4fd1', '#1c9ee8', '#f2a0c0'][Math.floor(Math.random() * 7)];
        g.beginPath(); // chip bag
        g.moveTo(x, y); g.lineTo(x + 48, y); g.lineTo(x + 44, y + 66); g.lineTo(x + 4, y + 66); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(x + 24, y + 30, 14, 0, 7); g.fill();
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y, 48, 6);
      }
    }
  });
}
export function kioskScreenTexture() {
  return ct(256, 320, (g, w, h) => {
    g.fillStyle = '#101418'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#17b978'; g.fillRect(0, 0, w, 70);
    g.fillStyle = '#fff'; g.font = '700 26px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText('Scan & Pay', w / 2, 44);
    g.fillStyle = '#232a33'; g.fillRect(28, 100, w - 56, 130);
    g.fillStyle = '#fff'; g.fillRect(58, 120, 140, 90);
    g.fillStyle = '#000';
    for (let i = 0; i < 120; i++) if (Math.random() > .5) g.fillRect(58 + (i % 12) * 12, 120 + Math.floor(i / 12) * 9, 10, 8);
    g.fillStyle = '#8fa2b5'; g.font = '15px sans-serif'; g.fillText('Tap. Grab. Go.', w / 2, h - 30);
  });
}
export function lockersTexture() {
  return ct(512, 256, (g, w, h) => {
    g.fillStyle = '#cfd2cd'; g.fillRect(0, 0, w, h);
    const cols = 8, rows = 4;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * w / cols, y = r * h / rows;
      g.fillStyle = '#c3c7c1'; g.fillRect(x + 2, y + 2, w / cols - 4, h / rows - 4);
      g.strokeStyle = '#9aa09a'; g.strokeRect(x + 2, y + 2, w / cols - 4, h / rows - 4);
      g.fillStyle = '#7d837d'; g.fillRect(x + 8, y + h / rows / 2 - 2, 12, 5); // handle
      g.fillStyle = '#5f6b8c'; g.fillRect(x + w / cols - 22, y + 8, 12, 8); // lock light
    }
  });
}
export function arcadeSideTexture() {
  return ct(256, 512, (g, w, h) => {
    g.fillStyle = '#f2c521'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1450b4';
    g.beginPath(); g.arc(w * .5, h * .34, w * .3, .6, 5.7); g.lineTo(w * .5, h * .34); g.closePath(); g.fill(); // pac wedge
    g.fillStyle = '#e2262d'; g.beginPath(); g.arc(w * .68, h * .62, w * .13, Math.PI, 0);
    g.lineTo(w * .81, h * .75); g.lineTo(w * .55, h * .75); g.closePath(); g.fill(); // ghost
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w * .63, h * .62, 8, 0, 7); g.arc(w * .73, h * .62, 8, 0, 7); g.fill();
    g.fillStyle = '#101010'; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 60, w, 60);
  });
}

// ---------- rug ----------
export function rugTexture() {
  return ct(512, 340, (g, w, h) => {
    g.fillStyle = '#b9a58c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8a2f2b'; g.fillRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#c8b295'; g.fillRect(30, 30, w - 60, h - 60);
    g.strokeStyle = '#6d4a3a'; g.lineWidth = 3;
    for (let i = 0; i < 40; i++) { // ornaments
      const x = 40 + Math.random() * (w - 80), y = 40 + Math.random() * (h - 80);
      g.strokeRect(x, y, 14, 14);
    }
    g.fillStyle = '#8a2f2b';
    g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI / 4); g.fillRect(-55, -55, 110, 110); g.restore();
    g.fillStyle = '#c8b295'; g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI / 4); g.fillRect(-35, -35, 70, 70); g.restore();
    g.fillStyle = '#3f5c6e'; g.beginPath(); g.arc(w / 2, h / 2, 24, 0, 7); g.fill();
    g.strokeStyle = '#5e3a30'; g.lineWidth = 6; g.strokeRect(20, 20, w - 40, h - 40);
  });
}

// ---------- dynamic screens ----------
export function makeTV() {
  const tex = ct(512, 288, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); });
  let slide = 0;
  const draw = (info) => {
    const g = tex.ctx, w = 512, h = 288;
    slide = (slide + 1) % 4;
    g.fillStyle = ['#0b5da8', '#232f3e', '#0d7a3f', '#5a2a82'][slide];
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.fillStyle = '#fff';
    if (slide === 0) {
      g.font = '700 44px "Segoe UI", sans-serif'; g.fillText('avenue C', w / 2, 120);
      g.font = '26px "Segoe UI", sans-serif'; g.fillText('Snacks · Drinks · Fresh food', w / 2, 170);
    } else if (slide === 1) {
      g.font = '700 40px "Segoe UI", sans-serif'; g.fillText('Stay productive', w / 2, 110);
      g.font = '24px "Segoe UI", sans-serif'; g.fillStyle = '#f90';
      g.fillText('Your safety is our priority', w / 2, 165);
    } else if (slide === 2) {
      g.font = '700 36px "Segoe UI", sans-serif'; g.fillText(`${info.online} associates on break`, w / 2, 105);
      g.font = '24px "Segoe UI", sans-serif'; g.fillText('Say hi! 👋', w / 2, 160);
    } else {
      g.font = '700 34px "Segoe UI", sans-serif'; g.fillText('🏓 PING PONG LADDER', w / 2, 90);
      g.font = '22px "Segoe UI", sans-serif';
      g.fillText(info.pongLine1 || 'Table A open', w / 2, 150);
      g.fillText(info.pongLine2 || 'Table B open', w / 2, 190);
    }
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, h - 8, ((slide + 1) / 4) * w, 8);
    tex.needsUpdate = true;
  };
  return { tex, draw };
}
export function makeClock() {
  const tex = ct(256, 96, (g) => { g.fillStyle = '#180404'; g.fillRect(0, 0, 256, 96); });
  const draw = () => {
    const g = tex.ctx;
    g.fillStyle = '#1a0505'; g.fillRect(0, 0, 256, 96);
    const d = new Date();
    let hh = d.getHours() % 12; if (hh === 0) hh = 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    g.fillStyle = '#ff2418'; g.font = '700 64px "Courier New", monospace'; g.textAlign = 'center';
    g.shadowColor = '#ff2418'; g.shadowBlur = 16;
    g.fillText(`${hh}:${mm}`, 128, 70);
    g.shadowBlur = 0;
    tex.needsUpdate = true;
  };
  draw();
  return { tex, draw };
}

// tape "COUCH"-style zone outline decal
export function tapeZoneTexture(label, w = 512, h = 384) {
  return ct(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#1f6fd6'; g.lineWidth = 10;
    g.strokeRect(8, 8, w - 16, h - 16);
    if (label) {
      g.fillStyle = '#f5f3ee'; g.fillRect(w / 2 - 70, h - 46, 140, 36);
      g.fillStyle = '#111'; g.font = '700 26px "Segoe UI", sans-serif'; g.textAlign = 'center';
      g.fillText(label, w / 2, h - 19);
    }
  });
}
export function hazardSquareTexture() {
  return ct(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.save();
    g.strokeStyle = '#e8c520'; g.lineWidth = 14; g.setLineDash([26, 18]);
    g.strokeRect(10, 10, w - 20, h - 20);
    g.strokeStyle = '#111'; g.lineDashOffset = 26;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.restore();
  });
}
