/** Sector center coordinates for Islamabad. Mirrors `apps/mobile/lib/mock/providers.ts`. */
export const SECTOR_COORDS: Record<string, { lat: number; lng: number }> = {
  'F-6': { lat: 33.7295, lng: 73.0775 },
  'F-7': { lat: 33.717, lng: 73.0707 },
  'F-8/1': { lat: 33.7055, lng: 73.0525 },
  'F-8/2': { lat: 33.704, lng: 73.049 },
  'F-10/1': { lat: 33.6945, lng: 73.018 },
  'F-10/3': { lat: 33.6938, lng: 73.0162 },
  'F-11/1': { lat: 33.685, lng: 73.007 },
  'F-11/3': { lat: 33.684, lng: 73.004 },
  'G-9': { lat: 33.68, lng: 72.987 },
  'G-10': { lat: 33.684, lng: 72.982 },
  'G-11': { lat: 33.662, lng: 72.976 },
  'G-13': { lat: 33.647, lng: 72.951 },
  'I-8/3': { lat: 33.662, lng: 73.079 },
  'I-9': { lat: 33.652, lng: 73.07 },
};

export const SECTORS = Object.keys(SECTOR_COORDS);
