export interface SvgLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  strokeDasharray: string;
  animationDelay?: string;
}

export const SVG_LINES: SvgLine[] = [
  {
    x1: 160,
    y1: 60,
    x2: 56,
    y2: 280,
    stroke: 'url(#gradient1)',
    strokeWidth: 2.5,
    strokeDasharray: '6 4',
  },
  {
    x1: 160,
    y1: 60,
    x2: 264,
    y2: 200,
    stroke: 'url(#gradient2)',
    strokeWidth: 2.5,
    strokeDasharray: '6 4',
    animationDelay: '0.3s',
  },
  {
    x1: 56,
    y1: 280,
    x2: 264,
    y2: 200,
    stroke: 'url(#gradient3)',
    strokeWidth: 2.5,
    strokeDasharray: '6 4',
    animationDelay: '0.6s',
  },
];

export const SVG_VIEWBOX = '0 0 320 320';
export const SVG_OPACITY = 0.3;
