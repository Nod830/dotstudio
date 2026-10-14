// 기본 제공 팔레트 (픽셀 아트 커뮤니티에서 널리 쓰는 것들)
const PALETTES = {
  'DawnBringer 32': '000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30',
  'Endesga 32': 'be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569',
  'PICO-8': '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa',
  'Sweetie 16': '1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57',
  '게임보이': '0f380f 306230 8bac0f 9bbc0f',
  '흑백 8': '000000 242424 494949 6d6d6d 929292 b6b6b6 dbdbdb ffffff',
};

function hexToColor(hex) {
  hex = hex.replace('#', '').trim();
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function colorToHex(c) {
  return '#' + c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
}

function colorsEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function paletteColors(name) {
  return PALETTES[name].split(' ').map(hexToColor);
}
