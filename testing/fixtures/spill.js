import { hasTTY } from './common.js';

const count = Number(process.argv[2] || 4000);
const prefix = hasTTY ? 'spill line' : 'spill fallback line';
for (let i = 0; i < count; i++) console.log(`${prefix} ${i + 1}`);
