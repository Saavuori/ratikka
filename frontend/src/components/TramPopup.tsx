/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useState } from 'react';
import type { VehiclePosition, TripDetailsResponse } from '../types';
import { fetchTripDetails } from '../lib/api';
import { AlertTriangle, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Activity, Gauge, Compass, Cpu, Database, Users, ShieldCheck } from 'lucide-react';

interface TramPopupProps {
  tram: VehiclePosition;
  onClose: () => void;
  onRouteNameReady?: (name: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const TramPopup: React.FC<TramPopupProps> = ({
  tram,
  onClose,
  onRouteNameReady,
  isCollapsed,
  onToggleCollapse,
}) => {
  // Suppress unused variable warning for onClose
  if (false as boolean) {
    onClose();
  }

  const [tripDetails, setTripDetails] = useState<TripDetailsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllStops, setShowAllStops] = useState<boolean>(false);
  const [lastStopId, setLastStopId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'telemetry' | 'schedule' | 'diagnostics'>('telemetry');

  // Diagnostic states
  const [latency, setLatency] = useState<number>(0);

  useEffect(() => {
    if (tram.stop) {
      setLastStopId(tram.stop);
    }
  }, [tram.stop]);

  useEffect(() => {
    // Live latency tick
    const interval = setInterval(() => {
      setLatency(Date.now() - (tram.ts * 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [tram.ts]);

  useEffect(() => {
    if (!tram.tripId) {
      setError('Trip ID not available for this vehicle');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setTripDetails(null);
    setShowAllStops(false); // Reset to collapsed on trip change
    setLastStopId(tram.stop || null);

    fetchTripDetails(tram.tripId)
      .then((data) => {
        setTripDetails(data);
        setLoading(false);
        if (onRouteNameReady && data.route?.longName) {
          onRouteNameReady(data.route.longName);
        }
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load schedule details');
        setLoading(false);
      });
  }, [tram.tripId]);

  const getDelayColor = (seconds: number) => {
    if (seconds > 60) return '#f87171';
    if (seconds < -60) return '#38bdf8';
    return '#34d399';
  };

  // Determine current position in the schedule.
  // tram.stop = the GTFS ID of the stop the tram most recently passed or is currently at.
  // drst === 1 means doors open = stopped at a stop.
  const getStopIndices = () => {
    if (!tripDetails) return { currentStopIndex: -1, nextStopIndex: -1, lastKnownIndex: -1 };

    const isStopped = tram.drst === 1;
    const stopIdToMatch = tram.stop || lastStopId;
    let upcomingIndex = tripDetails.stops.findIndex(s => s.gtfsId === stopIdToMatch);

    if (upcomingIndex === -1) {
      // Fallback: Estimate position based on arrival times
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const nextIndex = tripDetails.stops.findIndex(stop => {
        const [h, m] = stop.realtimeArrival.split(':').map(Number);
        const stopMinutes = h * 60 + m;
        return stopMinutes >= currentMinutes;
      });

      if (nextIndex !== -1) {
        upcomingIndex = nextIndex;
      } else {
        upcomingIndex = tripDetails.stops.length - 1;
      }
    }

    if (isStopped) {
      // Doors open: we ARE at this stop
      const currentStopIndex = upcomingIndex;
      const nextStopIndex = upcomingIndex + 1 < tripDetails.stops.length ? upcomingIndex + 1 : -1;
      return { currentStopIndex, nextStopIndex, lastKnownIndex: upcomingIndex };
    } else {
      // Moving: heading to upcomingIndex, last passed is upcomingIndex - 1
      const nextStopIndex = upcomingIndex;
      const lastKnownIndex = upcomingIndex - 1;
      return { currentStopIndex: -1, nextStopIndex, lastKnownIndex };
    }
  };

  const speedKmh = Math.round(tram.spd * 3.6);
  const isDoorsOpen = tram.drst === 1;
  const isMoving = speedKmh > 0;
  
  // Calculate wheel speed (seconds per rotation)
  const wheelSpeedCss = isMoving ? `${Math.max(0.1, 3.6 / tram.spd)}s` : '0s';

  const resolveOperatorName = (id?: number) => {
    if (id === undefined) return 'HSL Operator';
    const ops: Record<number, string> = {
      6: 'Oy Pohjolan Liikenne Ab',
      12: 'Helsingin Bussiliikenne',
      18: 'Oy Pohjolan Liikenne Ab',
      22: 'Nobina Finland Oy',
      40: 'Tammelundin Liikenne',
      47: 'Åbergin Linja Oy',
      50: 'Pääkaupunkiseudun Kaupunkiliikenne Oy',
      9: 'Pääkaupunkiseudun Kaupunkiliikenne Oy',
    };
    return ops[id] || `Operator #${id}`;
  };

  // Speedometer details
  const speedometerCircumference = 2 * Math.PI * 26; // Radius 26
  const speedometerOffset = speedometerCircumference - (Math.min(60, speedKmh) / 60) * speedometerCircumference;

  // G-Force/Accelerometer calculation
  const accVal = tram.acc ?? 0;
  const accPercent = Math.min(100, (Math.abs(accVal) / 1.5) * 100);

  return (
    <div className={`glass-panel detail-popup ${isCollapsed ? 'collapsed' : ''}`} style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Dynamic Keyframes injecting locally */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin-wheels {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes blink-light {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 5px #00b894); }
          50% { opacity: 0.2; filter: none; }
        }
        .rotating-wheel {
          transform-origin: center;
          animation: spin-wheels var(--wheel-speed, 1s) linear infinite;
        }
        .blinking-door-light {
          animation: blink-light 0.8s infinite;
        }
        .door-leaf-left {
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .door-leaf-right {
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
      ` }} />

      {/* Collapse/Expand Toggle Tab */}
      <button
        className="detail-toggle-tab"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Show Schedule' : 'Hide Schedule'}
      >
        <span className="icon-desktop">
          {isCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="icon-mobile">
          {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* Header */}
      <div className="panel-header" style={{ padding: '0 0 10px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="desi-circle">{tram.desi}</div>
          <div>
            <h2 style={{ fontSize: '0.8rem', fontWeight: 700, margin: 0, color: '#e2e8f0' }}>
              {tripDetails?.headsign ? `→ ${tripDetails.headsign}` : `Line ${tram.desi}`}
            </h2>
            <p className="panel-subtitle" style={{ marginTop: '1px' }}>
              {tripDetails?.route.longName || 'Loading route…'}
            </p>
          </div>
        </div>
      </div>

      {/* Overengineered Tabs Navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '12px', marginTop: '6px' }}>
        <button 
          onClick={() => setActiveTab('telemetry')} 
          style={{
            flex: 1, padding: '8px 4px', background: 'none', border: 'none',
            borderBottom: activeTab === 'telemetry' ? `2px solid ${tram.mode === 'bus' ? '#0984e3' : '#00b894'}` : '2px solid transparent',
            color: activeTab === 'telemetry' ? '#f8fafc' : '#64748b',
            fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
          }}
        >
          <Gauge size={11} />
          Telemetry
        </button>
        <button 
          onClick={() => setActiveTab('schedule')} 
          style={{
            flex: 1, padding: '8px 4px', background: 'none', border: 'none',
            borderBottom: activeTab === 'schedule' ? `2px solid ${tram.mode === 'bus' ? '#0984e3' : '#00b894'}` : '2px solid transparent',
            color: activeTab === 'schedule' ? '#f8fafc' : '#64748b',
            fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
          }}
        >
          <Activity size={11} />
          Schedule
        </button>
        <button 
          onClick={() => setActiveTab('diagnostics')} 
          style={{
            flex: 1, padding: '8px 4px', background: 'none', border: 'none',
            borderBottom: activeTab === 'diagnostics' ? `2px solid ${tram.mode === 'bus' ? '#0984e3' : '#00b894'}` : '2px solid transparent',
            color: activeTab === 'diagnostics' ? '#f8fafc' : '#64748b',
            fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
          }}
        >
          <Cpu size={11} />
          Diagnostics
        </button>
      </div>

      {/* Main Tab Area */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        
        {/* TELEMETRY TAB */}
        {activeTab === 'telemetry' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            {/* Live Visual Vehicle Schematic Card */}
            <div style={{
              background: 'var(--bg-card)', padding: '12px 14px', borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.03)', textAlign: 'center'
            }}>
              <span style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>
                Vehicle Control Diagnostics
              </span>

              {/* 2D Schematic Graphic */}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
                {tram.mode === 'bus' ? (
                  /* BUS SCHEMATIC */
                  <svg width="220" height="70" viewBox="0 0 220 70" fill="none">
                    <line x1="10" y1="58" x2="210" y2="58" stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="4 4"/>
                    <rect x="25" y="15" width="170" height="36" rx="3" fill="rgba(30, 41, 59, 0.4)" stroke="#0984e3" strokeWidth="2"/>
                    <path d="M25,20 L35,20 L35,35 L25,35 Z" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" strokeWidth="1"/>
                    
                    {/* Front door leaves */}
                    <rect className="door-leaf-left" style={{ transform: isDoorsOpen ? 'translateX(-5px)' : 'none', transformOrigin: '53px 15px' }} x="53" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
                    <rect className="door-leaf-right" style={{ transform: isDoorsOpen ? 'translateX(5px)' : 'none', transformOrigin: '59px 15px' }} x="59" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
                    
                    {/* Rear door leaves */}
                    <rect className="door-leaf-left" style={{ transform: isDoorsOpen ? 'translateX(-5px)' : 'none', transformOrigin: '133px 15px' }} x="133" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
                    <rect className="door-leaf-right" style={{ transform: isDoorsOpen ? 'translateX(5px)' : 'none', transformOrigin: '139px 15px' }} x="139" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>

                    {/* Indicator lights */}
                    <circle cx="59" cy="11" r="3" fill={isDoorsOpen ? '#34d399' : '#f87171'} className={isDoorsOpen ? 'blinking-door-light' : ''}/>
                    <circle cx="139" cy="11" r="3" fill={isDoorsOpen ? '#34d399' : '#f87171'} className={isDoorsOpen ? 'blinking-door-light' : ''}/>

                    {/* Rubber tires */}
                    <g className={isMoving ? 'rotating-wheel' : ''} style={{ '--wheel-speed': wheelSpeedCss, transformOrigin: '55px 54px' } as React.CSSProperties}>
                      <circle cx="55" cy="54" r="8" fill="#111827" stroke="#374151" strokeWidth="2"/>
                      <circle cx="55" cy="54" r="8" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="3,3"/>
                      <circle cx="55" cy="54" r="3" fill="#94a3b8"/>
                    </g>
                    <g className={isMoving ? 'rotating-wheel' : ''} style={{ '--wheel-speed': wheelSpeedCss, transformOrigin: '155px 54px' } as React.CSSProperties}>
                      <circle cx="155" cy="54" r="8" fill="#111827" stroke="#374151" strokeWidth="2"/>
                      <circle cx="155" cy="54" r="8" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="3,3"/>
                      <circle cx="155" cy="54" r="3" fill="#94a3b8"/>
                    </g>
                  </svg>
                ) : (
                  /* TRAM SCHEMATIC */
                  <svg width="220" height="70" viewBox="0 0 220 70" fill="none">
                    <line x1="10" y1="58" x2="210" y2="58" stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="4 4"/>
                    <rect x="20" y="15" width="180" height="36" rx="6" fill="rgba(30, 41, 59, 0.4)" stroke="#00b894" strokeWidth="2"/>
                    <path d="M20,20 L30,20 L30,35 L20,35 Z" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" strokeWidth="1"/>
                    <path d="M200,20 L190,20 L190,35 L200,35 Z" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" strokeWidth="1"/>

                    {/* Door Set 1 */}
                    <rect className="door-leaf-left" style={{ transform: isDoorsOpen ? 'translateX(-5px)' : 'none', transformOrigin: '58px 15px' }} x="58" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
                    <rect className="door-leaf-right" style={{ transform: isDoorsOpen ? 'translateX(5px)' : 'none', transformOrigin: '64px 15px' }} x="64" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
                    
                    {/* Door Set 2 */}
                    <rect className="door-leaf-left" style={{ transform: isDoorsOpen ? 'translateX(-5px)' : 'none', transformOrigin: '108px 15px' }} x="108" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
                    <rect className="door-leaf-right" style={{ transform: isDoorsOpen ? 'translateX(5px)' : 'none', transformOrigin: '114px 15px' }} x="114" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
                    
                    {/* Door Set 3 */}
                    <rect className="door-leaf-left" style={{ transform: isDoorsOpen ? 'translateX(-5px)' : 'none', transformOrigin: '158px 15px' }} x="158" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
                    <rect className="door-leaf-right" style={{ transform: isDoorsOpen ? 'translateX(5px)' : 'none', transformOrigin: '164px 15px' }} x="164" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>

                    {/* Indicator lights */}
                    <circle cx="64" cy="11" r="3" fill={isDoorsOpen ? '#34d399' : '#f87171'} className={isDoorsOpen ? 'blinking-door-light' : ''}/>
                    <circle cx="114" cy="11" r="3" fill={isDoorsOpen ? '#34d399' : '#f87171'} className={isDoorsOpen ? 'blinking-door-light' : ''}/>
                    <circle cx="164" cy="11" r="3" fill={isDoorsOpen ? '#34d399' : '#f87171'} className={isDoorsOpen ? 'blinking-door-light' : ''}/>

                    {/* Spinning Wheels */}
                    <g className={isMoving ? 'rotating-wheel' : ''} style={{ '--wheel-speed': wheelSpeedCss, transformOrigin: '45px 54px' } as React.CSSProperties}>
                      <circle cx="45" cy="54" r="6" fill="#1e293b" stroke="#64748b" strokeWidth="2"/>
                      <circle cx="45" cy="54" r="6" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" strokeDasharray="2,2"/>
                      <circle cx="45" cy="54" r="2" fill="#94a3b8"/>
                    </g>
                    <g className={isMoving ? 'rotating-wheel' : ''} style={{ '--wheel-speed': wheelSpeedCss, transformOrigin: '95px 54px' } as React.CSSProperties}>
                      <circle cx="95" cy="54" r="6" fill="#1e293b" stroke="#64748b" strokeWidth="2"/>
                      <circle cx="95" cy="54" r="6" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" strokeDasharray="2,2"/>
                      <circle cx="95" cy="54" r="2" fill="#94a3b8"/>
                    </g>
                    <g className={isMoving ? 'rotating-wheel' : ''} style={{ '--wheel-speed': wheelSpeedCss, transformOrigin: '145px 54px' } as React.CSSProperties}>
                      <circle cx="145" cy="54" r="6" fill="#1e293b" stroke="#64748b" strokeWidth="2"/>
                      <circle cx="145" cy="54" r="6" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" strokeDasharray="2,2"/>
                      <circle cx="145" cy="54" r="2" fill="#94a3b8"/>
                    </g>
                    <g className={isMoving ? 'rotating-wheel' : ''} style={{ '--wheel-speed': wheelSpeedCss, transformOrigin: '175px 54px' } as React.CSSProperties}>
                      <circle cx="175" cy="54" r="6" fill="#1e293b" stroke="#64748b" strokeWidth="2"/>
                      <circle cx="175" cy="54" r="6" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" strokeDasharray="2,2"/>
                      <circle cx="175" cy="54" r="2" fill="#94a3b8"/>
                    </g>
                  </svg>
                )}
              </div>

              {/* Door telemetry state string */}
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  backgroundColor: isDoorsOpen ? '#34d399' : '#ef4444',
                  boxShadow: isDoorsOpen ? '0 0 6px #34d399' : '0 0 6px #ef4444'
                }}/>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: isDoorsOpen ? '#34d399' : '#f87171', textTransform: 'uppercase' }}>
                  {isDoorsOpen ? 'Boarding Active (Doors Open)' : 'Secured (Doors Closed)'}
                </span>
              </div>
            </div>

            {/* Dials & Gauges Row */}
            <div style={{ display: 'flex', gap: '10px' }}>
              
              {/* Speedometer Radial Gauge */}
              <div style={{
                flex: 1, background: 'var(--bg-card)', padding: '12px', borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center'
              }}>
                <span style={{ fontSize: '0.55rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', marginBottom: '8px' }}>
                  Speedometer
                </span>
                <div style={{ position: 'relative', width: '64px', height: '64px' }}>
                  <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="32" cy="32" r="26" stroke="rgba(255,255,255,0.04)" strokeWidth="4.5" fill="none"/>
                    <circle cx="32" cy="32" r="26" stroke={tram.mode === 'bus' ? '#0984e3' : '#00b894'} strokeWidth="4.5" fill="none"
                            strokeDasharray={speedometerCircumference}
                            strokeDashoffset={speedometerOffset}
                            strokeLinecap="round"
                            style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}/>
                  </svg>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, width: '64px', height: '64px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>{speedKmh}</span>
                    <span style={{ fontSize: '0.45rem', color: '#94a3b8', marginTop: '-3px', textTransform: 'uppercase' }}>km/h</span>
                  </div>
                </div>
              </div>

              {/* Delay deviation Radial Gauge */}
              <div style={{
                flex: 1, background: 'var(--bg-card)', padding: '12px', borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center'
              }}>
                <span style={{ fontSize: '0.55rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', marginBottom: '8px' }}>
                  Schedule Deviation
                </span>
                <div style={{ position: 'relative', width: '64px', height: '64px' }}>
                  <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="32" cy="32" r="26" stroke="rgba(255,255,255,0.04)" strokeWidth="4.5" fill="none"/>
                    <circle cx="32" cy="32" r="26" stroke={getDelayColor(tram.dl)} strokeWidth="4.5" fill="none"
                            strokeDasharray={speedometerCircumference}
                            strokeDashoffset={speedometerCircumference - (Math.min(300, Math.abs(tram.dl)) / 300) * speedometerCircumference}
                            strokeLinecap="round"
                            style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}/>
                  </svg>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, width: '64px', height: '64px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 4px', boxSizing: 'border-box'
                  }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: getDelayColor(tram.dl) }}>
                      {tram.dl === 0 ? '±0' : (tram.dl < 0 ? '-' : '+') + Math.round(Math.abs(tram.dl) / 60)}m
                    </span>
                    <span style={{ fontSize: '0.45rem', color: '#94a3b8', marginTop: '-1px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {tram.dl < 0 ? 'early' : (tram.dl > 0 ? 'late' : 'on-time')}
                    </span>
                  </div>
                </div>
              </div>

            </div>

            {/* Bidirectional G-Force/Accelerometer indicator */}
            <div style={{
              background: 'var(--bg-card)', padding: '12px 14px', borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.03)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', marginBottom: '8px' }}>
                <span>Braking Force</span>
                <span style={{ color: accVal > 0.05 ? '#34d399' : (accVal < -0.05 ? '#f87171' : '#cbd5e1') }}>
                  Accelerometer: {accVal > 0 ? '+' : ''}{accVal.toFixed(2)} m/s²
                </span>
                <span>Acceleration</span>
              </div>
              <div style={{ height: '6px', width: '100%', background: 'rgba(255,255,255,0.04)', borderRadius: '3px', position: 'relative', overflow: 'hidden' }}>
                {/* Center marker */}
                <div style={{ position: 'absolute', left: '50%', top: 0, width: '2px', height: '100%', backgroundColor: 'rgba(255,255,255,0.15)', zIndex: 3 }}/>
                
                {/* Deceleration side */}
                {accVal < 0 && (
                  <div style={{
                    position: 'absolute', right: '50%', top: 0,
                    width: `${accPercent / 2}%`, height: '100%',
                    backgroundColor: '#f87171', borderRadius: '3px 0 0 3px',
                    boxShadow: '0 0 8px #f87171', transition: 'width 0.3s ease'
                  }}/>
                )}

                {/* Acceleration side */}
                {accVal > 0 && (
                  <div style={{
                    position: 'absolute', left: '50%', top: 0,
                    width: `${accPercent / 2}%`, height: '100%',
                    backgroundColor: '#34d399', borderRadius: '0 3px 3px 0',
                    boxShadow: '0 0 8px #34d399', transition: 'width 0.3s ease'
                  }}/>
                )}
              </div>
            </div>

            {/* Stop Callout (always visible under telemetry for context) */}
            {!loading && !error && tripDetails && (() => {
              const { currentStopIndex, nextStopIndex, lastKnownIndex } = getStopIndices();
              const isStopped = tram.drst === 1;

              if (lastKnownIndex === -1) return null;

              const currentStop = isStopped && currentStopIndex !== -1 ? tripDetails.stops[currentStopIndex] : null;
              const nextStop = nextStopIndex !== -1 ? tripDetails.stops[nextStopIndex] : null;

              return (
                <div className={`next-stop-callout ${isStopped ? 'stopped' : 'moving'}`} style={{ marginBottom: 0, padding: '10px 14px' }}>
                  {isStopped && currentStop && (
                    <div className="callout-main">
                      <div>
                        <span style={{ fontSize: '0.55rem', textTransform: 'uppercase', fontWeight: 800, color: '#f59e0b', display: 'block', letterSpacing: '0.05em' }}>
                          At stop
                        </span>
                        <span className="callout-val" style={{ fontSize: '0.8rem' }}>{currentStop.name}</span>
                      </div>
                    </div>
                  )}

                  {nextStop && (
                    <div className={isStopped ? 'next-stop-sub' : 'callout-main'} style={{ borderTop: isStopped ? '1px solid rgba(255,255,255,0.04)' : 'none', paddingTop: isStopped ? '6px' : 0 }}>
                      <div>
                        <span style={{ fontSize: '0.55rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--accent-green)', display: 'block', letterSpacing: '0.05em' }}>
                          Next stop
                        </span>
                        <span className="callout-val next-name" style={{ fontSize: '0.8rem' }}>{nextStop.name}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '0.55rem', textTransform: 'uppercase', fontWeight: 700, color: '#64748b', display: 'block' }}>ETA</span>
                        <span className="callout-val next-eta" style={{ fontSize: '0.85rem' }}>{nextStop.realtimeArrival}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        )}

        {/* SCHEDULE TAB */}
        {activeTab === 'schedule' && (
          <div>
            {/* Loading */}
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '36px 0', gap: '12px', color: '#94a3b8' }}>
                <Loader2 className="animate-spin" style={{ color: '#34d399' }} size={22} />
                <span style={{ fontSize: '0.7rem' }}>Loading schedule…</span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0', gap: '8px', color: '#ef4444', textAlign: 'center' }}>
                <AlertTriangle size={22} />
                <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{error}</span>
              </div>
            )}

            {/* Stop Timeline */}
            {!loading && !error && tripDetails && (() => {
              const { currentStopIndex, nextStopIndex, lastKnownIndex } = getStopIndices();
              const isStopped = tram.drst === 1;

              // Filter for upcoming stops only (excluding past stops entirely)
              const upcomingStops = tripDetails.stops
                .map((stop, idx) => ({ ...stop, originalIdx: idx }))
                .filter((stop) => {
                  if (lastKnownIndex === -1) return true;
                  return isStopped ? stop.originalIdx >= currentStopIndex : stop.originalIdx > lastKnownIndex;
                });

              if (upcomingStops.length === 0) {
                return (
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center', padding: '12px 0' }}>
                    End of line
                  </div>
                );
              }

              const stopsToRender = showAllStops ? upcomingStops : [upcomingStops[upcomingStops.length - 1]];

              return (
                <div className="timeline-container" style={{ marginTop: '4px' }}>
                  {upcomingStops.length > 1 && (
                    <button
                      onClick={() => setShowAllStops(!showAllStops)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-glow)',
                        background: 'var(--bg-button)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        marginBottom: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}
                    >
                      {showAllStops ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {showAllStops ? 'Hide stops' : `Show all intermediate stops (${upcomingStops.length - 1})`}
                    </button>
                  )}

                  <div className="timeline-list">
                    {stopsToRender.map((stop) => {
                      const idx = stop.originalIdx;
                      const isCurrent = idx === currentStopIndex && isStopped;
                      const isNext = idx === nextStopIndex;
                      const isUpcoming = !isCurrent && !isNext;

                      let itemClass = 'timeline-item';
                      if (isCurrent) itemClass += ' active current';
                      else if (isNext) itemClass += ' active next';
                      else if (isUpcoming) itemClass += ' upcoming';

                      return (
                        <div key={idx} className={itemClass}>
                          <span className="timeline-dot" />
                          <div className="timeline-stop-info">
                            <h4 className="timeline-stop-name">{stop.name}</h4>
                            {(isCurrent || isNext || !showAllStops) && (
                              <span className="timeline-stop-code">{stop.code}</span>
                            )}
                          </div>
                          <div className="timeline-time-info">
                            <span className="timeline-time">{stop.realtimeArrival}</span>
                            {stop.delay !== 0 && (
                              <span className="timeline-delay" style={{ color: getDelayColor(stop.delay) }}>
                                {stop.delay < 0 ? '-' : '+'}{Math.round(Math.abs(stop.delay) / 60)}m
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* DIAGNOSTICS TAB */}
        {activeTab === 'diagnostics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            
            {/* Operator registry & Vehicle ID */}
            <div style={{
              background: 'var(--bg-card)', padding: '10px 12px', borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.02)', fontSize: '0.7rem', color: '#cbd5e1'
            }}>
              <span style={{ fontSize: '0.55rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
                Registry Metadata
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}><ShieldCheck size={11} /> Operator</span>
                  <span style={{ fontWeight: 600 }}>{resolveOperatorName(tram.oper)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}><Database size={11} /> Vehicle Chassis</span>
                  <span style={{ fontFamily: 'monospace' }}>{tram.veh}</span>
                </div>
                {tram.occu !== undefined && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}><Users size={11} /> Occupancy</span>
                    <span style={{ fontWeight: 600 }}>{tram.occu}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* GPS Telemetry Grid */}
            <div style={{
              background: 'var(--bg-card)', padding: '10px 12px', borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.02)', fontSize: '0.7rem', color: '#cbd5e1'
            }}>
              <span style={{ fontSize: '0.55rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
                GPS Telemetry & Mapping
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}><Compass size={11} /> Coordinates</span>
                  <span>{tram.lat.toFixed(5)}°, {tram.lng.toFixed(5)}°</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}><Compass size={11} /> Heading (Bearing)</span>
                  <span>{tram.hdg}° ({tram.hdg}deg)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}><Database size={11} /> Location Source</span>
                  <span style={{ fontWeight: 600, color: 'var(--accent-green)' }}>{tram.loc === 'GPS' ? 'Satellite GPS' : (tram.loc || 'GPS')}</span>
                </div>
                {tram.odo !== undefined && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}><Database size={11} /> Odometer Reading</span>
                    <span>{(tram.odo / 1000).toFixed(2)} km</span>
                  </div>
                )}
              </div>
            </div>

            {/* Stream Sync Analytics */}
            <div style={{
              background: 'var(--bg-card)', padding: '10px 12px', borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.02)', fontSize: '0.7rem', color: '#cbd5e1'
            }}>
              <span style={{ fontSize: '0.55rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
                WebSocket Signal Quality
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}><Activity size={11} /> HFP Update Drift</span>
                  <span style={{ color: Math.abs(latency) < 5000 ? '#34d399' : '#f87171', fontWeight: 600 }}>
                    {Math.abs(latency) < 100000 ? `${latency} ms` : 'Out of sync'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}><Activity size={11} /> Broadcast Frequency</span>
                  <span>1.0 Hz (MQTT)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}><Cpu size={11} /> Telemetry Epoch</span>
                  <span style={{ fontFamily: 'monospace' }}>{tram.ts}</span>
                </div>
              </div>
            </div>

            {/* Trip Route Metadata */}
            <div style={{
              background: 'var(--bg-card)', padding: '10px 12px', borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.02)', fontSize: '0.7rem', color: '#cbd5e1'
            }}>
              <span style={{ fontSize: '0.55rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
                GTFS Transit Schedule Info
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Route GTFS ID</span>
                  <span style={{ fontFamily: 'monospace' }}>{tram.route}</span>
                </div>
                {tram.dir && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>Direction ID</span>
                    <span>{tram.dir}</span>
                  </div>
                )}
                {tram.start && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>Scheduled Start</span>
                    <span>{tram.start} {tram.oday ? `(${tram.oday})` : ''}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Trip GTFS ID</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.62rem', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tram.tripId}>
                    {tram.tripId}
                  </span>
                </div>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};

export default TramPopup;
