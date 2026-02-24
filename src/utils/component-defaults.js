/**
 * Default WordPress/Gutenberg values for markup generation.
 */

export const CLASS_PATTERNS = {
  alignment: {
    pattern: 'has-text-align-{value}',
    values: ['left', 'center', 'right', 'justify'],
  },
  blockAlignment: {
    pattern: 'align{value}',
    values: ['left', 'center', 'right', 'wide', 'full', 'none'],
  },
  backgroundColor: {
    pattern: 'has-{slug}-background-color',
    additional: 'has-background',
  },
  textColor: {
    pattern: 'has-{slug}-color',
    additional: 'has-text-color',
  },
  fontSize: {
    pattern: 'has-{slug}-font-size',
  },
  gradient: {
    pattern: 'has-{slug}-gradient-background',
    additional: 'has-background',
  },
};

export const DEFAULT_COLORS = [
  { name: 'Black', slug: 'black', color: '#000000' },
  { name: 'Cyan bluish gray', slug: 'cyan-bluish-gray', color: '#abb8c3' },
  { name: 'White', slug: 'white', color: '#ffffff' },
  { name: 'Pale pink', slug: 'pale-pink', color: '#f78da7' },
  { name: 'Vivid red', slug: 'vivid-red', color: '#cf2e2e' },
  { name: 'Luminous vivid orange', slug: 'luminous-vivid-orange', color: '#ff6900' },
  { name: 'Luminous vivid amber', slug: 'luminous-vivid-amber', color: '#fcb900' },
  { name: 'Light green cyan', slug: 'light-green-cyan', color: '#7bdcb5' },
  { name: 'Vivid green cyan', slug: 'vivid-green-cyan', color: '#00d084' },
  { name: 'Pale cyan blue', slug: 'pale-cyan-blue', color: '#8ed1fc' },
  { name: 'Vivid cyan blue', slug: 'vivid-cyan-blue', color: '#0693e3' },
  { name: 'Vivid purple', slug: 'vivid-purple', color: '#9b51e0' },
];

export const DEFAULT_FONT_SIZES = [
  { name: 'Small', slug: 'small', size: '13px' },
  { name: 'Medium', slug: 'medium', size: '20px' },
  { name: 'Large', slug: 'large', size: '36px' },
  { name: 'Extra Large', slug: 'x-large', size: '42px' },
];

export const DEFAULT_GRADIENTS = [
  { name: 'Vivid cyan blue to vivid purple', slug: 'vivid-cyan-blue-to-vivid-purple', gradient: 'linear-gradient(135deg,rgba(6,147,227,1) 0%,rgb(155,81,224) 100%)' },
  { name: 'Light green cyan to vivid green cyan', slug: 'light-green-cyan-to-vivid-green-cyan', gradient: 'linear-gradient(135deg,rgb(122,220,180) 0%,rgb(0,208,130) 100%)' },
  { name: 'Luminous vivid amber to luminous vivid orange', slug: 'luminous-vivid-amber-to-luminous-vivid-orange', gradient: 'linear-gradient(135deg,rgba(252,185,0,1) 0%,rgba(255,105,0,1) 100%)' },
  { name: 'Luminous vivid orange to vivid red', slug: 'luminous-vivid-orange-to-vivid-red', gradient: 'linear-gradient(135deg,rgba(255,105,0,1) 0%,rgb(207,46,46) 100%)' },
  { name: 'Very light gray to cyan bluish gray', slug: 'very-light-gray-to-cyan-bluish-gray', gradient: 'linear-gradient(135deg,rgb(238,238,238) 0%,rgb(169,184,195) 100%)' },
];
