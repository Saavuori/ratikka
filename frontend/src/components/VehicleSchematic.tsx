import React from 'react';
import { getModeAccent } from '../lib/routeColors';
import { occupancyColor, occupancyLabel } from '../lib/occupancy';
import './vehicleSchematic.css';

interface VehicleSchematicProps {
  /** Vehicle mode as the feed reports it: `tram`, `bus`, `metro`, `train` or `ferry`. */
  mode: string | null | undefined;
  isDoorsOpen: boolean;
  isMoving: boolean;
  /** Wheel rotation period as a CSS duration, e.g. `0.4s`. */
  wheelSpeedCss: string;
  /**
   * Reported passenger load, 0…1, or null where the mode does not measure it.
   * Only the ferry does, and only the ferry schematic draws it.
   */
  occupancy?: number | null;
}

/** Sliding door leaves — they part when the real doors are open. */
const DoorPair: React.FC<{ x: number; open: boolean; height?: number }> = ({ x, open, height = 31 }) => (
  <>
    <rect
      className="door-leaf-left"
      style={{ transform: open ? 'translateX(-5px)' : 'none', transformOrigin: `${x}px 15px` }}
      x={x} y="20" width="6" height={height} fill="#475569" stroke="#1e293b" strokeWidth="1"
    />
    <rect
      className="door-leaf-right"
      style={{ transform: open ? 'translateX(5px)' : 'none', transformOrigin: `${x + 6}px 15px` }}
      x={x + 6} y="20" width="6" height={height} fill="#475569" stroke="#1e293b" strokeWidth="1"
    />
  </>
);

/** The green/red lamp above a door, blinking while that door is open. */
const DoorLight: React.FC<{ cx: number; open: boolean }> = ({ cx, open }) => (
  <circle cx={cx} cy="11" r="3" fill={open ? '#34d399' : '#f87171'} className={open ? 'blinking-door-light' : ''} />
);

/** A wheel that spins at the vehicle's own speed while it is moving. */
const Wheel: React.FC<{ cx: number; r: number; moving: boolean; speed: string; tyre?: boolean }> = ({
  cx, r, moving, speed, tyre = false,
}) => (
  <g
    className={moving ? 'rotating-wheel' : ''}
    style={{ '--wheel-speed': speed, transformOrigin: `${cx}px 54px` } as React.CSSProperties}
  >
    <circle cx={cx} cy="54" r={r} fill={tyre ? '#111827' : '#1e293b'} stroke={tyre ? '#374151' : '#64748b'} strokeWidth="2" />
    <circle cx={cx} cy="54" r={r} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={tyre ? 1 : 0.8} strokeDasharray={tyre ? '3,3' : '2,2'} />
    <circle cx={cx} cy="54" r={tyre ? 3 : 2} fill="#94a3b8" />
  </g>
);

const Ground: React.FC = () => (
  <line x1="10" y1="58" x2="210" y2="58" stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="4 4" />
);

/**
 * Side-on schematic of the selected vehicle, one drawing per mode: the doors
 * slide with the real `drst` flag and the wheels turn at the reported speed.
 *
 * Each mode gets its own body rather than sharing one generic rail carriage —
 * a coupled two-unit metro, a nose-and-pantograph commuter train, a
 * single-carriage tram and a boxy bus — so the panel shows the vehicle you
 * actually clicked. Everything is tinted with the mode's accent colour.
 */
export const VehicleSchematic: React.FC<VehicleSchematicProps> = ({
  mode,
  isDoorsOpen,
  isMoving,
  wheelSpeedCss,
  occupancy = null,
}) => {
  const accent = getModeAccent(mode);
  const glass = { fill: 'rgba(56, 189, 248, 0.15)', stroke: '#38bdf8', strokeWidth: 1 };
  const bodyFill = 'rgba(30, 41, 59, 0.4)';

  if (mode === 'bus') {
    return (
      <svg width="220" height="70" viewBox="0 0 220 70" fill="none">
        <Ground />
        <rect x="25" y="15" width="170" height="36" rx="3" fill={bodyFill} stroke={accent} strokeWidth="2" />
        <path d="M25,20 L35,20 L35,35 L25,35 Z" {...glass} />

        <DoorPair x={53} open={isDoorsOpen} />
        <DoorPair x={133} open={isDoorsOpen} />

        <DoorLight cx={59} open={isDoorsOpen} />
        <DoorLight cx={139} open={isDoorsOpen} />

        <Wheel cx={55} r={8} moving={isMoving} speed={wheelSpeedCss} tyre />
        <Wheel cx={155} r={8} moving={isMoving} speed={wheelSpeedCss} tyre />
      </svg>
    );
  }

  if (mode === 'metro') {
    // Two units coupled nose to nose — the seam in the middle and the cab at
    // each outer end are what a Helsinki metro train looks like from the
    // platform, and it reverses at the terminus rather than turning around.
    return (
      <svg width="220" height="70" viewBox="0 0 220 70" fill="none">
        <Ground />
        <rect x="12" y="15" width="92" height="36" rx="4" fill={bodyFill} stroke={accent} strokeWidth="2" />
        <rect x="116" y="15" width="92" height="36" rx="4" fill={bodyFill} stroke={accent} strokeWidth="2" />
        {/* Coupling between the two units */}
        <rect x="104" y="29" width="12" height="8" rx="2" fill="#475569" stroke="#1e293b" strokeWidth="1" />

        {/* Cab windscreens, one at each outer end */}
        <path d="M12,20 L22,20 L22,33 L12,33 Z" {...glass} />
        <path d="M208,20 L198,20 L198,33 L208,33 Z" {...glass} />

        {/* The white band the M-stock carries along its flank */}
        <rect x="12" y="37" width="92" height="2" fill="rgba(255,255,255,0.45)" />
        <rect x="116" y="37" width="92" height="2" fill="rgba(255,255,255,0.45)" />

        {/* Two door sets per unit */}
        <DoorPair x={36} open={isDoorsOpen} />
        <DoorPair x={74} open={isDoorsOpen} />
        <DoorPair x={140} open={isDoorsOpen} />
        <DoorPair x={178} open={isDoorsOpen} />

        <DoorLight cx={42} open={isDoorsOpen} />
        <DoorLight cx={80} open={isDoorsOpen} />
        <DoorLight cx={146} open={isDoorsOpen} />
        <DoorLight cx={184} open={isDoorsOpen} />

        <Wheel cx={28} r={6} moving={isMoving} speed={wheelSpeedCss} />
        <Wheel cx={90} r={6} moving={isMoving} speed={wheelSpeedCss} />
        <Wheel cx={130} r={6} moving={isMoving} speed={wheelSpeedCss} />
        <Wheel cx={192} r={6} moving={isMoving} speed={wheelSpeedCss} />
      </svg>
    );
  }

  if (mode === 'train') {
    // Commuter unit: the raked nose at the front and the pantograph on the roof
    // are the two things that tell an Sm-series train apart from a tram at a
    // glance, and it rides on paired bogie wheels rather than single axles.
    return (
      <svg width="220" height="70" viewBox="0 0 220 70" fill="none">
        <Ground />
        {/* Pantograph on the roof, reaching for the overhead wire */}
        <line x1="20" y1="6" x2="210" y2="6" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <path d="M94,15 L102,8 L116,8 L124,15" stroke="#94a3b8" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
        <line x1="102" y1="8" x2="116" y2="8" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />

        {/* Body with a raked cab nose at the leading (left) end */}
        <path
          d="M40,15 L198,15 C202,15 205,18 205,22 L205,44 C205,48 202,51 198,51 L34,51 C22,51 14,44 14,36 L14,32 C14,23 26,15 40,15 Z"
          fill={bodyFill} stroke={accent} strokeWidth="2"
        />
        {/* Slanted windscreen following the nose */}
        <path d="M40,19 L52,19 L52,33 L19,33 C20,26 28,20 40,19 Z" {...glass} />

        <DoorPair x={78} open={isDoorsOpen} />
        <DoorPair x={122} open={isDoorsOpen} />
        <DoorPair x={166} open={isDoorsOpen} />

        <DoorLight cx={84} open={isDoorsOpen} />
        <DoorLight cx={128} open={isDoorsOpen} />
        <DoorLight cx={172} open={isDoorsOpen} />

        {/* Two bogies, two wheels each */}
        <rect x="46" y="49" width="34" height="4" rx="2" fill="#334155" />
        <rect x="150" y="49" width="34" height="4" rx="2" fill="#334155" />
        <Wheel cx={54} r={6} moving={isMoving} speed={wheelSpeedCss} />
        <Wheel cx={72} r={6} moving={isMoving} speed={wheelSpeedCss} />
        <Wheel cx={158} r={6} moving={isMoving} speed={wheelSpeedCss} />
        <Wheel cx={176} r={6} moving={isMoving} speed={wheelSpeedCss} />
      </svg>
    );
  }

  if (mode === 'ferry') {
    // The Suomenlinna boat, seen from the quay: a hull sitting in the water with
    // a bow wave when it is making way, a saloon with the bridge above it, and
    // a funnel aft. No wheels — the "moving" cue is the water, which is what it
    // is on the real thing too.
    //
    // The saloon is drawn as a glass tank rather than a solid band, because this
    // is the one mode that reports how full it is: the reported load fills the
    // saloon from the stern forward in the load colour, and the reading is
    // written underneath in the same colour. A vessel with no count reported
    // gets an empty saloon and no caption rather than a green one.
    const loaded = typeof occupancy === 'number' && Number.isFinite(occupancy);
    const load = loaded ? Math.max(0, Math.min(1, occupancy!)) : 0;
    const saloon = { x: 34, y: 20, width: 150, height: 20 };
    const fill = saloon.width * load;
    const loadTint = loaded ? occupancyColor(load) : '#64748b';

    return (
      <svg width="220" height="70" viewBox="0 0 220 70" fill="none">
        {/* Waterline, and the wake the hull pushes while under way. */}
        <line x1="10" y1="58" x2="210" y2="58" stroke="rgba(56,189,248,0.25)" strokeWidth="2" />
        {isMoving && (
          // The bow wave. Static, and deliberately so: nothing here spins, and
          // a wake animated by the wheel-rotation period would be a wheel with
          // a boat drawn over it. Its presence is the motion cue.
          <g stroke="rgba(56,189,248,0.5)" strokeWidth="1.5" fill="none" strokeLinecap="round">
            <path d="M198,52 C204,50 209,52 213,55" />
            <path d="M196,57 C202,57 207,58 211,60" />
          </g>
        )}

        {/* Hull: raked stem forward (right), transom aft (left). */}
        <path
          d="M26,40 L186,40 C196,40 202,45 204,50 C205,54 202,57 197,57 L33,57
             C28,57 25,54 25,49 L25,43 C25,41 25,40 26,40 Z"
          fill={bodyFill} stroke={accent} strokeWidth="2"
        />
        {/* Saloon: the tank the load fills, from the stern (left) forward. */}
        <rect x={saloon.x} y={saloon.y} width={saloon.width} height={saloon.height}
              rx="3" fill="rgba(15,23,42,0.35)" stroke={accent} strokeWidth="2" />
        {fill > 0 && (
          <rect x={saloon.x} y={saloon.y} width={fill} height={saloon.height} rx="3" fill={loadTint} opacity="0.75" />
        )}
        {/* Bridge on the saloon roof, and the funnel behind it. */}
        <path d="M150,20 L176,20 L180,10 L154,10 Z" fill={bodyFill} stroke={accent} strokeWidth="2" />
        <path d="M156,18 L176,18 L178,12 L158,12 Z" {...glass} />
        <rect x="60" y="12" width="9" height="8" rx="2" fill="#334155" stroke="#1e293b" strokeWidth="1" />

        {/* Side boarding ramp, amidships. */}
        <DoorPair x={100} open={isDoorsOpen} height={17} />
        <DoorLight cx={106} open={isDoorsOpen} />

        {loaded && (
          <text x="110" y="68" textAnchor="middle" fontSize="8" fontWeight="700" fill={loadTint}>
            {`${occupancyLabel(load)} — ${Math.round(load * 100)}%`}
          </text>
        )}
      </svg>
    );
  }

  // Tram (and anything unrecognised): a single carriage with a cab at both ends.
  return (
    <svg width="220" height="70" viewBox="0 0 220 70" fill="none">
      <Ground />
      <rect x="20" y="15" width="180" height="36" rx="6" fill={bodyFill} stroke={accent} strokeWidth="2" />
      <path d="M20,20 L30,20 L30,35 L20,35 Z" {...glass} />
      <path d="M200,20 L190,20 L190,35 L200,35 Z" {...glass} />

      <DoorPair x={58} open={isDoorsOpen} />
      <DoorPair x={108} open={isDoorsOpen} />
      <DoorPair x={158} open={isDoorsOpen} />

      <DoorLight cx={64} open={isDoorsOpen} />
      <DoorLight cx={114} open={isDoorsOpen} />
      <DoorLight cx={164} open={isDoorsOpen} />

      <Wheel cx={45} r={6} moving={isMoving} speed={wheelSpeedCss} />
      <Wheel cx={95} r={6} moving={isMoving} speed={wheelSpeedCss} />
      <Wheel cx={145} r={6} moving={isMoving} speed={wheelSpeedCss} />
      <Wheel cx={175} r={6} moving={isMoving} speed={wheelSpeedCss} />
    </svg>
  );
};
