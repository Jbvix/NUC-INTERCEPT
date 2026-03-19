import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Anchor, 
  Navigation, 
  Wind, 
  Activity, 
  Map as MapIcon, 
  Settings,
  Plus,
  Trash2,
  ChevronLeft,
  Target,
  Crosshair,
  Calculator,
  Waves,
  Route,
  Fuel,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Globe2,
  ToggleLeft,
  ToggleRight,
  Ship,
  Lock,
  Unlock
} from 'lucide-react';

/**
 * SIMULADOR DE REBOQUE OCEÂNICO E DERIVA (UNIVERSAL NUC)
 * -------------------------------------------------------------------
 * Ano: 2026 | Data: 18/03 | Hora: 19:15 (-03:00)
 * Versão: 2.4.0 - Densidade de Tráfego & UX Centralizada
 * Autor: Jossian Brito
 */

const App = () => {
  // --- REFERÊNCIAS GERAIS ---
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  
  // --- REFERÊNCIAS DAS CAMADAS CARTOGRÁFICAS ---
  const osmLayerRef = useRef(null);
  const satLayerRef = useRef(null);
  const nauticalLayerRef = useRef(null);
  const densityLayerRef = useRef(null); // Nova camada de tráfego (v2.4.0)

  // --- ESTADOS DE GESTÃO DE CAMADAS E UX ---
  const [baseMap, setBaseMap] = useState('osm'); 
  const [showNautical, setShowNautical] = useState(true); 
  const [showDensity, setShowDensity] = useState(false); // Toggle de Tráfego
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  
  // --- STATE MACHINE (MAPA) ---
  const [mapMode, setMapMode] = useState('VIEW'); 
  const mapModeRef = useRef(mapMode);
  useEffect(() => { mapModeRef.current = mapMode; }, [mapMode]);

  // --- ESTADOS DE DADOS TÁTICOS ---
  const [targetPos, setTargetPos] = useState(null); 
  const [waypoints, setWaypoints] = useState([]); 
  
  // --- ESTADOS DE CALCULADORA VETORIAL ---
  const [currentDir, setCurrentDir] = useState(270); 
  const [currentSpeed, setCurrentSpeed] = useState(1.2); 
  const [windDir, setWindDir] = useState(90); 
  const [windSpeed, setWindSpeed] = useState(25); 
  const [leewayCoeff, setLeewayCoeff] = useState(0.03); 
  const [interceptETA, setInterceptETA] = useState(12); 
  
  // --- ESTADOS DE MÁQUINAS E DERROTA ---
  const [tugSpeed, setTugSpeed] = useState(10); 
  const [tugFuelRate, setTugFuelRate] = useState(150); 

  // --- INTERFACE E LAZY LOADING ---
  const [activeTab, setActiveTab] = useState('map'); 
  const [overlayView, setOverlayView] = useState(null); 
  const [isOverlayLocked, setIsOverlayLocked] = useState(true);
  const [windyUrl, setWindyUrl] = useState(null); 
  const [trafficUrl, setTrafficUrl] = useState(null); 

  // =======================================================================
  // MOTOR MATEMÁTICO: VETOR DE DERIVA E PIF
  // =======================================================================
  const driftData = useMemo(() => {
    if (!targetPos) return null;

    const cRad = (90 - currentDir) * (Math.PI / 180);
    const cX = currentSpeed * Math.cos(cRad);
    const cY = currentSpeed * Math.sin(cRad);

    const wPushDir = (windDir + 180) % 360;
    const wRad = (90 - wPushDir) * (Math.PI / 180);
    const wPushSpd = windSpeed * leewayCoeff;
    const wX = wPushSpd * Math.cos(wRad);
    const wY = wPushSpd * Math.sin(wRad);

    const resX = cX + wX;
    const resY = cY + wY;
    
    const driftSpd = Math.sqrt(resX * resX + resY * resY);
    const driftBearing = (90 - (Math.atan2(resY, resX) * (180 / Math.PI)) + 360) % 360;

    const distanceNM = driftSpd * interceptETA; 
    
    const R = 3440.065; 
    const lat1 = targetPos.lat * (Math.PI / 180);
    const lng1 = targetPos.lng * (Math.PI / 180);
    const brng = driftBearing * (Math.PI / 180);
    const dR = distanceNM / R;

    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(brng));
    const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(dR) * Math.cos(lat1), Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2));

    return {
      pifPos: { lat: lat2 * (180 / Math.PI), lng: lng2 * (180 / Math.PI) },
      effectiveSpeed: driftSpd,
      effectiveBearing: driftBearing
    };
  }, [targetPos, currentDir, currentSpeed, windDir, windSpeed, leewayCoeff, interceptETA]);

  // =======================================================================
  // MOTOR MATEMÁTICO: DERROTA E HAVERSINE
  // =======================================================================
  const calculateDist = (p1, p2) => {
    const R = 3440.065;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLon = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const routeData = useMemo(() => {
    if (waypoints.length < 2) return { distance: 0, eta: 0, fuel: 0 };
    
    let totalDist = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      totalDist += calculateDist(waypoints[i], waypoints[i+1]);
    }
    
    const eta = totalDist / tugSpeed;
    const fuel = eta * tugFuelRate;

    return { distance: totalDist, eta: eta, fuel: fuel };
  }, [waypoints, tugSpeed, tugFuelRate]);

  const isEtaSynced = waypoints.length >= 2 && Math.abs(routeData.eta - interceptETA) <= (interceptETA * 0.05);

  // =======================================================================
  // INICIALIZAÇÃO E EVENTOS DO MAPA (LEAFLET)
  // =======================================================================
  useEffect(() => {
    if (window.L) { setLeafletLoaded(true); return; }
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(link);
    const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.async = true; script.onload = () => setLeafletLoaded(true); document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current) return;
    if (!leafletMap.current) {
      const L = window.L;
      leafletMap.current = L.map(mapRef.current, { zoomControl: false }).setView([-3.717, -38.483], 5);
      
      // Criação silenciosa das camadas na RAM
      osmLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' });
      satLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri' });
      nauticalLayerRef.current = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { attribution: '© OpenSeaMap' });
      
      // Nova camada de densidade de tráfego (Tile genérico demonstrativo/público)
      densityLayerRef.current = L.tileLayer('https://tiles.marinetraffic.com/ais_density_tiles_2020/{z}/{x}/{y}.png', { 
        attribution: '© MarineTraffic',
        opacity: 0.6
      });
      
      // Definição rígida do Z-Index para respeitar a visualização tática
      osmLayerRef.current.setZIndex(0);
      satLayerRef.current.setZIndex(0);
      densityLayerRef.current.setZIndex(5);     // Tráfego por cima do mapa base
      nauticalLayerRef.current.setZIndex(10);   // Boias e Isobáticas por cima do tráfego

      // Injeta as camadas iniciais
      osmLayerRef.current.addTo(leafletMap.current);
      nauticalLayerRef.current.addTo(leafletMap.current);

      // Correção de tela preta via recálculo interno Leaflet
      setTimeout(() => {
        if (leafletMap.current) leafletMap.current.invalidateSize();
      }, 500);

      leafletMap.current.on('click', (e) => {
        const currentMode = mapModeRef.current;
        if (currentMode === 'SET_TARGET') {
          setTargetPos({ lat: e.latlng.lat, lng: e.latlng.lng });
          setMapMode('VIEW');
        } else if (currentMode === 'SET_WAYPOINT') {
          setWaypoints(prev => [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }]);
        }
      });
    }
    return () => {
      if (leafletMap.current) { leafletMap.current.off(); leafletMap.current.remove(); leafletMap.current = null; }
    };
  }, [leafletLoaded]);

  // =======================================================================
  // GESTÃO DINÂMICA DE CAMADAS (Data Save Mode)
  // =======================================================================
  useEffect(() => {
    if (!leafletMap.current) return;
    const map = leafletMap.current;

    // Se estivermos numa visualização de iframe (overlayView ativo), escondemos APENAS as camadas base opacas
    if (overlayView) {
      if (map.hasLayer(satLayerRef.current)) map.removeLayer(satLayerRef.current);
      if (map.hasLayer(osmLayerRef.current)) map.removeLayer(osmLayerRef.current);
      if (map.hasLayer(densityLayerRef.current)) map.removeLayer(densityLayerRef.current);
      
      // O OpenSeaMap (nauticalLayerRef) é transparente, permitimos ele se showNautical=true
      if (showNautical) {
        if (!map.hasLayer(nauticalLayerRef.current)) map.addLayer(nauticalLayerRef.current);
      } else {
        if (map.hasLayer(nauticalLayerRef.current)) map.removeLayer(nauticalLayerRef.current);
      }
      return;
    }

    // Gestão do Mapa Base Normal
    if (baseMap === 'osm') {
      if (map.hasLayer(satLayerRef.current)) map.removeLayer(satLayerRef.current);
      if (!map.hasLayer(osmLayerRef.current)) map.addLayer(osmLayerRef.current);
    } else {
      if (map.hasLayer(osmLayerRef.current)) map.removeLayer(osmLayerRef.current);
      if (!map.hasLayer(satLayerRef.current)) map.addLayer(satLayerRef.current);
    }

    // Gestão da Densidade de Tráfego
    if (showDensity) {
      if (!map.hasLayer(densityLayerRef.current)) map.addLayer(densityLayerRef.current);
    } else {
      if (map.hasLayer(densityLayerRef.current)) map.removeLayer(densityLayerRef.current);
    }

    // Gestão do Overlay Náutico OpenSeaMap
    if (showNautical) {
      if (!map.hasLayer(nauticalLayerRef.current)) map.addLayer(nauticalLayerRef.current);
    } else {
      if (map.hasLayer(nauticalLayerRef.current)) map.removeLayer(nauticalLayerRef.current);
    }
  }, [baseMap, showNautical, showDensity, overlayView, leafletLoaded]);

  // Força atualização agressiva do layout do Leaflet para prevenir tela preta ao retornar da aba
  useEffect(() => {
    if (leafletMap.current && activeTab === 'map') {
      setTimeout(() => {
        leafletMap.current.invalidateSize(true);
      }, 350);
    }
  }, [activeTab, overlayView]);

  // Renderização Visual Dinâmica de Marcadores e Linhas
  useEffect(() => {
    if (!leafletMap.current || !window.L) return;
    const L = window.L;
    
    leafletMap.current.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.Polyline) leafletMap.current.removeLayer(l); });

    if (targetPos) {
      L.marker([targetPos.lat, targetPos.lng], { 
        icon: L.divIcon({ html: '<div class="bg-red-500 w-5 h-5 rounded-full border-2 border-white shadow-lg flex items-center justify-center"><div class="w-1 h-1 bg-white rounded-full"></div></div>', className: '' }) 
      }).addTo(leafletMap.current).bindPopup('NUC: Posição Atual');
      
      if (driftData && driftData.pifPos) {
        L.polyline([[targetPos.lat, targetPos.lng], [driftData.pifPos.lat, driftData.pifPos.lng]], { 
          color: '#f97316', weight: 2, dashArray: '5, 10', opacity: 0.8
        }).addTo(leafletMap.current);

        L.marker([driftData.pifPos.lat, driftData.pifPos.lng], { 
          icon: L.divIcon({ html: '<div class="bg-orange-500 w-6 h-6 rounded-full border-4 border-orange-200/50 shadow-2xl animate-pulse flex items-center justify-center text-[8px] font-black text-white">PIF</div>', className: '' }) 
        }).addTo(leafletMap.current).bindPopup(`PIF em ${interceptETA}h`);
      }
    }

    if (waypoints.length > 0) {
      const pathCoords = waypoints.map(w => [w.lat, w.lng]);
      L.polyline(pathCoords, { color: '#3b82f6', weight: 3 }).addTo(leafletMap.current);

      waypoints.forEach((wp, idx) => {
        const isOrigem = idx === 0;
        L.marker([wp.lat, wp.lng], {
          icon: L.divIcon({ html: `<div class="${isOrigem ? 'bg-emerald-500 w-5 h-5' : 'bg-blue-500 w-4 h-4'} rounded-full border-2 border-white shadow-lg flex items-center justify-center text-[8px] font-black text-white">${idx === 0 ? 'Orig' : idx}</div>`, className: '' })
        }).addTo(leafletMap.current);
      });
    }
  }, [leafletLoaded, targetPos, driftData, interceptETA, waypoints]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* --- HEADER --- */}
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center z-[2000] shadow-md">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-blue-600 to-emerald-600 p-2 rounded-xl shadow-lg">
            <Anchor size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight leading-none uppercase m-0 text-white">TUGLIFE Planner</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">v2.4 (Traffic) | Jossian Brito</p>
          </div>
        </div>
        <div className="flex gap-2">
          {waypoints.length > 0 && (
            <button onClick={() => setWaypoints([])} className="p-2 bg-slate-800 rounded-lg text-yellow-500 hover:bg-slate-700 transition-colors">
              <Route size={18} />
            </button>
          )}
          {targetPos && (
            <button onClick={() => { setTargetPos(null); setWaypoints([]); }} className="p-2 bg-slate-800 rounded-lg text-red-400 hover:bg-slate-700 transition-colors">
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </header>
      
      {/* Botões de Overlay e Controle de Acesso */}
      {overlayView && (
        <div className="absolute top-20 left-4 z-[3000] flex flex-col gap-2">
          <button onClick={() => { setOverlayView(null); setIsOverlayLocked(true); }} className="flex items-center gap-2 px-4 py-3 bg-slate-900/90 text-white rounded-xl border border-slate-700 font-bold text-xs shadow-2xl hover:bg-slate-800 cursor-pointer justify-center transition-all">
            <ChevronLeft size={16} /> MAPA BASE
          </button>
          <button 
            onClick={() => setIsOverlayLocked(!isOverlayLocked)} 
            className={`flex items-center gap-2 px-4 py-3 text-white rounded-xl border font-bold text-[10px] shadow-2xl cursor-pointer transition-all justify-center ${isOverlayLocked ? 'bg-emerald-600/90 border-emerald-500 hover:bg-emerald-500' : 'bg-red-600/90 border-red-500 hover:bg-red-500'}`}
          >
            {isOverlayLocked ? <Lock size={14} /> : <Unlock size={14} />}
            {isOverlayLocked ? 'CADEADO(ON): MAPA E FOCO LIVRE' : 'CADEADO(OFF): IFRAMES LIVRES'}
          </button>
        </div>
      )}

      {/* --- ÁREA PRINCIPAL --- */}
      <main className="flex-1 relative bg-slate-950">
        
        {/* --- IFRAMES EM BACKGROUND --- */}
        <div className={`absolute inset-0 z-[500] transition-opacity duration-300 ${overlayView === 'windy' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          {windyUrl && <iframe src={windyUrl} className="w-full h-full border-none" title="Windy" />}
        </div>

        <div className={`absolute inset-0 z-[500] transition-opacity duration-300 ${overlayView === 'traffic' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          {trafficUrl && <iframe src={trafficUrl} className="w-full h-full border-none" title="Marine Traffic" />}
        </div>

        {/* --- MAPA TÁTICO --- */}
        <div className={`h-full w-full absolute transition-opacity duration-300 ${activeTab !== 'map' ? 'opacity-0 pointer-events-none' : 'opacity-100'} ${overlayView && !isOverlayLocked ? 'pointer-events-none z-[1000]' : 'z-[1000] pointer-events-auto'}`}>
          <div ref={mapRef} className={`h-full w-full bg-transparent ${mapMode !== 'VIEW' ? 'cursor-crosshair' : 'cursor-default'}`} />
          
          {/* AVISOS DE INSTRUÇÃO (STATE MACHINE) */}
          {mapMode === 'SET_TARGET' && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[1000] bg-red-500 text-white px-6 py-3 rounded-full font-black text-xs uppercase tracking-widest shadow-2xl animate-pulse flex items-center gap-2 border-2 border-red-300">
              <Crosshair size={16} /> Toque no local da Emergência
            </div>
          )}
          {mapMode === 'SET_WAYPOINT' && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[1000] bg-blue-500 text-white px-6 py-3 rounded-full font-black text-xs uppercase tracking-widest shadow-2xl animate-pulse flex items-center gap-2 border-2 border-blue-300">
              <Route size={16} /> Toque no mapa para traçar a Derrota
            </div>
          )}

          {/* MENU FLUTUANTE DE CAMADAS CARTOGRÁFICAS (UX CENTRALIZADA v2.4.0) */}
          <div className="absolute top-6 right-4 z-[1000] pointer-events-auto">
            <button 
              onClick={() => setShowLayerMenu(!showLayerMenu)}
              className="p-3 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-2xl shadow-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <Layers size={22} />
            </button>
            
            {showLayerMenu && (
              <div className="absolute top-14 right-0 bg-slate-900/95 backdrop-blur-lg border border-slate-700 p-4 rounded-2xl shadow-2xl w-56 flex flex-col gap-4 animate-in fade-in slide-in-from-top-2">
                
                {/* Seçāo: Mapa Base */}
                <div>
                  <h4 className="text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Mapa Base</h4>
                  <div className="flex bg-slate-800 rounded-lg p-1">
                    <button 
                      onClick={() => setBaseMap('osm')}
                      className={`flex-1 flex justify-center items-center py-2 rounded-md text-[10px] font-black uppercase transition-all ${baseMap === 'osm' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400'}`}
                    >
                      <MapIcon size={14} className="mr-1" /> Vetor
                    </button>
                    <button 
                      onClick={() => setBaseMap('satellite')}
                      className={`flex-1 flex justify-center items-center py-2 rounded-md text-[10px] font-black uppercase transition-all ${baseMap === 'satellite' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400'}`}
                    >
                      <Globe2 size={14} className="mr-1" /> Satélite
                    </button>
                  </div>
                </div>
                
                {/* Seção: Overlays Nativos */}
                <div className="border-t border-slate-800 pt-3 flex flex-col gap-2">
                  <h4 className="text-[10px] font-black uppercase text-slate-500 mb-1 tracking-widest">Tático (Overlays)</h4>
                  <button 
                    onClick={() => setShowNautical(!showNautical)}
                    className={`w-full flex justify-between items-center px-3 py-2 rounded-lg border transition-all ${showNautical ? 'bg-blue-900/30 border-blue-500/50 text-blue-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                  >
                    <span className="text-[10px] font-black uppercase">OpenSeaMap</span>
                    {showNautical ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                  <button 
                    onClick={() => setShowDensity(!showDensity)}
                    className={`w-full flex justify-between items-center px-3 py-2 rounded-lg border transition-all ${showDensity ? 'bg-purple-900/30 border-purple-500/50 text-purple-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                  >
                    <span className="text-[10px] font-black uppercase">Densidade de Tráfego</span>
                    {showDensity ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                </div>

                {/* Seção: Iframes Inteligência */}
                <div className="border-t border-slate-800 pt-3">
                  <h4 className="text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Inteligência (VSAT)</h4>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        const lat = targetPos ? targetPos.lat : -3.717;
                        const lng = targetPos ? targetPos.lng : -38.483;
                        const params = new URLSearchParams({
                          lat: lat.toString(),
                          lon: lng.toString(),
                          zoom: '5',
                          level: 'surface',
                          overlay: 'wind',
                          menu: '',
                          message: 'true',
                          marker: targetPos ? `${targetPos.lat},${targetPos.lng}` : '',
                          calendar: 'now',
                          pressure: '',
                          type: 'map',
                          location: 'coordinates',
                          detail: '',
                          metricWind: 'kt',
                          metricTemp: '°C',
                          radarRange: '-1'
                        });
                        setWindyUrl(`https://embed.windy.com/embed.html?${params.toString()}`);
                        
                        setOverlayView('windy');
                        setShowLayerMenu(false);
                        if (leafletMap.current) {
                          leafletMap.current.setView([lat, lng], 5);
                        }
                      }}
                      className="flex-1 flex flex-col justify-center items-center py-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-blue-400 transition-colors"
                    >
                      <Wind size={16} className="mb-1" />
                      <span className="text-[9px] font-black uppercase">Windy</span>
                    </button>
                    <button 
                      onClick={() => {
                        const lat = targetPos ? targetPos.lat : -3.717;
                        const lng = targetPos ? targetPos.lng : -38.483;
                        setTrafficUrl(`https://www.marinetraffic.com/en/ais/embed/centerx:${lng}/centery:${lat}/zoom:5/mmsi:0/showmenu:false`);
                        setOverlayView('traffic');
                        setShowLayerMenu(false);
                        if (leafletMap.current) {
                          leafletMap.current.setView([lat, lng], 5);
                        }
                      }}
                      className="flex-1 flex flex-col justify-center items-center py-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-emerald-400 transition-colors"
                    >
                      <Ship size={16} className="mb-1" />
                      <span className="text-[9px] font-black uppercase">Live AIS</span>
                    </button>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* PAINEL FLUTUANTE DE CONTROLE TÁTICO */}
          <div className="absolute top-24 left-4 z-[1000] pointer-events-none mt-2 w-52">
            <div className="bg-slate-900/95 backdrop-blur-md p-3 rounded-2xl border border-slate-700/50 shadow-2xl pointer-events-auto flex flex-col gap-3">
              <div className="flex gap-2">
                <button 
                  onClick={() => { setMapMode(mapMode === 'SET_TARGET' ? 'VIEW' : 'SET_TARGET'); setShowLayerMenu(false); }} 
                  className={`flex-1 flex flex-col items-center justify-center p-2 rounded-xl border text-[10px] font-black uppercase transition-all ${mapMode === 'SET_TARGET' ? 'bg-red-500 text-white border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                >
                  <Target size={16} className="mb-1" /> {targetPos ? 'Refazer' : 'Alvo NUC'}
                </button>
                <button 
                  onClick={() => { setMapMode(mapMode === 'SET_WAYPOINT' ? 'VIEW' : 'SET_WAYPOINT'); setShowLayerMenu(false); }} 
                  disabled={!targetPos}
                  className={`flex-1 flex flex-col items-center justify-center p-2 rounded-xl border text-[10px] font-black uppercase transition-all ${mapMode === 'SET_WAYPOINT' ? 'bg-blue-500 text-white border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : !targetPos ? 'opacity-30 bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                >
                  <Route size={16} className="mb-1" /> Derrota
                </button>
              </div>

              {/* Ticker de Validação de Interceptação */}
              {targetPos && waypoints.length >= 2 && (
                <div className={`p-2 rounded-lg border flex justify-between items-center text-[10px] font-black uppercase tracking-widest ${isEtaSynced ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-orange-500/20 border-orange-500/50 text-orange-400'}`}>
                  <span>ETA Sincronizado?</span>
                  {isEtaSynced ? <CheckCircle2 size={14} className="text-emerald-400" /> : <AlertTriangle size={14} className="animate-pulse" />}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* --- ABA: CALCULADORA AMBIENTAL (VETORES) --- */}
        {activeTab === 'calc' && !overlayView && (
          <div className="absolute inset-0 z-[1100] bg-slate-950 p-6 overflow-y-auto space-y-6 animate-in fade-in slide-in-from-bottom-10 duration-300">
            <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2 m-0 text-orange-500"><Calculator size={20} className="text-orange-500" /> Vector Engine</h2>
            <p className="text-xs text-slate-400 m-0">Insira a meteorologia do local de emergência para projetar o **PIF** no mapa.</p>

            <div className="bg-slate-900 p-5 rounded-2xl border border-blue-900/50 space-y-4 shadow-lg">
              <h3 className="text-xs font-black uppercase text-blue-400 flex items-center gap-2 m-0"><Wind size={16}/> Vento</h3>
              <div>
                <div className="flex justify-between text-[10px] font-bold mb-2 uppercase text-slate-400"><span>De Onde Sopra</span><span className="text-blue-400 text-sm font-mono">{windDir}°</span></div>
                <input type="range" min="0" max="359" value={windDir} onChange={(e) => setWindDir(Number(e.target.value))} className="w-full accent-blue-500" />
              </div>
              <div>
                <div className="flex justify-between text-[10px] font-bold mb-2 uppercase text-slate-400"><span>Velocidade</span><span className="text-blue-400 text-sm font-mono">{windSpeed} Nós</span></div>
                <input type="range" min="0" max="60" value={windSpeed} onChange={(e) => setWindSpeed(Number(e.target.value))} className="w-full accent-blue-500" />
              </div>
            </div>

            <div className="bg-slate-900 p-5 rounded-2xl border border-orange-900/50 space-y-4 shadow-lg">
              <h3 className="text-xs font-black uppercase text-orange-400 flex items-center gap-2 m-0"><Waves size={16}/> Corrente</h3>
              <div>
                <div className="flex justify-between text-[10px] font-bold mb-2 uppercase text-slate-400"><span>Para Onde Vai (Set)</span><span className="text-orange-400 text-sm font-mono">{currentDir}°</span></div>
                <input type="range" min="0" max="359" value={currentDir} onChange={(e) => setCurrentDir(Number(e.target.value))} className="w-full accent-orange-500" />
              </div>
              <div>
                <div className="flex justify-between text-[10px] font-bold mb-2 uppercase text-slate-400"><span>Velocidade (Drift)</span><span className="text-orange-400 text-sm font-mono">{currentSpeed.toFixed(1)} Nós</span></div>
                <input type="range" min="0" max="5" step="0.1" value={currentSpeed} onChange={(e) => setCurrentSpeed(Number(e.target.value))} className="w-full accent-orange-500" />
              </div>
            </div>

            <div className="bg-slate-900 p-5 rounded-2xl border border-emerald-900/50 space-y-4 shadow-lg">
              <h3 className="text-xs font-black uppercase text-emerald-400 flex items-center gap-2 m-0"><Target size={16}/> Tempo Alvo (PIF)</h3>
              <div>
                <div className="flex justify-between text-[10px] font-bold mb-2 uppercase text-slate-400"><span>Janela de Interceptação</span><span className="text-emerald-400 text-sm font-mono">{interceptETA} Horas</span></div>
                <input type="range" min="1" max="48" value={interceptETA} onChange={(e) => setInterceptETA(Number(e.target.value))} className="w-full accent-emerald-500" />
              </div>
            </div>
          </div>
        )}

        {/* --- ABA: GESTÃO DA DERROTA --- */}
        {activeTab === 'route' && !overlayView && (
          <div className="absolute inset-0 z-[1100] bg-slate-950 p-6 overflow-y-auto space-y-6 animate-in fade-in slide-in-from-bottom-10 duration-300">
            <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2 m-0 text-blue-500"><Navigation size={20} className="text-blue-500" /> Gestão da Derrota</h2>
            <p className="text-xs text-slate-400 m-0">Ajuste as máquinas do rebocador para sincronizar a sua rota com a janela de interceção do alvo.</p>

            {/* SYNC DASHBOARD */}
            <div className="grid grid-cols-2 gap-4">
              <div className={`p-4 rounded-2xl border flex flex-col items-center justify-center text-center shadow-lg transition-colors ${isEtaSynced ? 'bg-emerald-900/30 border-emerald-500/50' : 'bg-slate-900 border-slate-700'}`}>
                <span className="text-[10px] font-black uppercase text-slate-500 mb-1">ETA Rebocador</span>
                <span className={`text-2xl font-mono font-black ${isEtaSynced ? 'text-emerald-400' : 'text-slate-200'}`}>{routeData.eta.toFixed(1)}<span className="text-sm">h</span></span>
              </div>
              <div className="p-4 rounded-2xl border bg-slate-900 border-slate-700 flex flex-col items-center justify-center text-center shadow-lg">
                <span className="text-[10px] font-black uppercase text-slate-500 mb-1">ETA Alvo (PIF)</span>
                <span className="text-2xl font-mono font-black text-orange-400">{interceptETA.toFixed(1)}<span className="text-sm">h</span></span>
              </div>
            </div>

            {/* MÁQUINAS E BUNKER */}
            <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 space-y-4 shadow-lg">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xs font-black uppercase text-slate-300 flex items-center gap-2 m-0"><Settings size={16}/> Máquinas & Desempenho</h3>
                <span className="text-xs font-mono font-black text-blue-400">{routeData.distance.toFixed(1)} NM (Total)</span>
              </div>
              
              <div>
                <div className="flex justify-between text-[10px] font-bold mb-2 uppercase text-slate-500"><span>Vel. Trânsito Livre</span><span className="text-blue-400 text-sm font-mono">{tugSpeed} Nós</span></div>
                <input type="range" min="1" max="20" value={tugSpeed} onChange={(e) => setTugSpeed(Number(e.target.value))} className="w-full accent-blue-500" />
              </div>
              <div>
                <div className="flex justify-between text-[10px] font-bold mb-2 uppercase text-slate-500"><span>Consumo (Fuel Rate)</span><span className="text-slate-300 text-sm font-mono">{tugFuelRate} L/h</span></div>
                <input type="range" min="50" max="1000" step="10" value={tugFuelRate} onChange={(e) => setTugFuelRate(Number(e.target.value))} className="w-full accent-slate-500" />
              </div>
              
              <div className="pt-4 mt-4 border-t border-slate-800 flex justify-between items-center">
                <span className="text-[10px] font-black uppercase text-slate-500 flex items-center gap-1"><Fuel size={14}/> Bunker Estimado (Ida)</span>
                <span className="text-lg font-mono font-black text-yellow-500">{routeData.fuel.toFixed(0)} Litros</span>
              </div>
            </div>

            {/* LISTA DE WAYPOINTS */}
            <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 space-y-4 shadow-lg">
              <h3 className="text-xs font-black uppercase text-slate-300 flex items-center gap-2 m-0"><Route size={16}/> Waypoints ({waypoints.length})</h3>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-2">
                {waypoints.length === 0 ? (
                  <p className="text-[10px] text-slate-500 uppercase text-center py-4 font-bold m-0">Nenhum Waypoint traçado.</p>
                ) : (
                  waypoints.map((wp, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-slate-950 p-2 rounded-lg border border-slate-800">
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black text-white ${idx === 0 ? 'bg-emerald-500' : 'bg-blue-500'}`}>{idx === 0 ? 'Ori' : idx}</div>
                        <div className="flex flex-col">
                          <span className="text-[9px] font-mono text-slate-400">Lat: {wp.lat.toFixed(4)}</span>
                          <span className="text-[9px] font-mono text-slate-400">Lng: {wp.lng.toFixed(4)}</span>
                        </div>
                      </div>
                      <button onClick={() => setWaypoints(waypoints.filter((_, i) => i !== idx))} className="text-slate-600 hover:text-red-400 p-1 bg-transparent border-0 cursor-pointer"><Trash2 size={14} /></button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* --- TABBAR INFERIOR --- */}
      <nav className="bg-slate-900 border-t border-slate-800 p-2 pb-8 flex justify-around items-center z-[2000] relative">
        <button onClick={() => { setActiveTab('map'); setOverlayView(null); }} className={`flex flex-col items-center gap-1 p-3 rounded-2xl w-24 transition-all bg-transparent border-0 cursor-pointer ${activeTab === 'map' && !overlayView ? 'text-blue-400 bg-blue-500/10' : 'text-slate-600 hover:text-slate-400'}`}>
          <MapIcon size={22} />
          <span className="text-[9px] font-black uppercase tracking-tighter">Tático</span>
        </button>
        <button onClick={() => { setActiveTab('calc'); setOverlayView(null); }} className={`flex flex-col items-center gap-1 p-3 rounded-2xl w-24 transition-all bg-transparent border-0 cursor-pointer ${activeTab === 'calc' && !overlayView ? 'text-orange-400 bg-orange-500/10' : 'text-slate-600 hover:text-slate-400'}`}>
          <Calculator size={22} />
          <span className="text-[9px] font-black uppercase tracking-tighter">Vector Calc</span>
        </button>
        <button onClick={() => { setActiveTab('route'); setOverlayView(null); }} className={`flex flex-col items-center gap-1 p-3 rounded-2xl w-24 transition-all bg-transparent border-0 cursor-pointer ${activeTab === 'route' && !overlayView ? 'text-emerald-400 bg-emerald-500/10 relative' : 'text-slate-600 hover:text-slate-400 relative'}`}>
          {isEtaSynced && activeTab !== 'route' && <span className="absolute top-2 right-6 w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>}
          <Navigation size={22} />
          <span className="text-[9px] font-black uppercase tracking-tighter">Derrota</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
