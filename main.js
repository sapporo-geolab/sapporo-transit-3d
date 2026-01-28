mapboxgl.accessToken = "pk.eyJ1Ijoic2FwcG9yby1nZW9sYWIiLCJhIjoiY21rbm4yOXE5MDdwNDNkczh5MnlqNnI4eCJ9.Utenu-9vEz56uGUETeWS1g";

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/light-v11',
    center: CONFIG.MAP.CENTER,
    zoom: CONFIG.MAP.ZOOM,
    pitch: CONFIG.MAP.PITCH,
    bearing: CONFIG.MAP.BEARING,
    antialias: true
});

const STATION_ALTITUDE = { "南平岸": 25, "澄川": 25, "自衛隊前": 25, "真駒内": 25 };

map.on('load', async () => {
    const layers = map.getStyle().layers;
    layers.forEach(layer => {
        if (layer.id !== 'background') {
            if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-opacity', 0);
            if (layer.type === 'line') map.setPaintProperty(layer.id, 'line-opacity', 0);
            if (layer.type === 'symbol') map.setPaintProperty(layer.id, 'text-opacity', 0);
            if (layer.type === 'circle') map.setPaintProperty(layer.id, 'circle-opacity', 0);
        } else {
            map.setPaintProperty('background', 'background-color', '#111111');
        }
    });

    map.addLayer({ 'id': 'floating-parks', 'source': 'composite', 'source-layer': 'landuse', 'type': 'fill-extrusion', 'filter': ['match', ['get', 'class'], ['park', 'grass', 'wood', 'scrub'], true, false], 'paint': { 'fill-extrusion-color': '#ffffff', 'fill-extrusion-base': CONFIG.CITY.FLOAT_HEIGHT, 'fill-extrusion-height': CONFIG.CITY.FLOAT_HEIGHT + 0.1, 'fill-extrusion-opacity': 0.4 } });
    map.addLayer({ 'id': 'floating-water', 'source': 'composite', 'source-layer': 'water', 'type': 'fill-extrusion', 'paint': { 'fill-extrusion-color': '#b0c4de', 'fill-extrusion-base': CONFIG.CITY.FLOAT_HEIGHT + 0.1, 'fill-extrusion-height': CONFIG.CITY.FLOAT_HEIGHT + 0.2, 'fill-extrusion-opacity': 0.3 } });
    map.addLayer({ 'id': 'floating-roads', 'source': 'composite', 'source-layer': 'road', 'type': 'line', 'filter': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street'], true, false], 'paint': { 'line-color': '#ffffff', 'line-width': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 8, ['secondary', 'tertiary'], 4, 2], 'line-opacity': 0.6 } });
    map.addLayer({ 'id': 'floating-buildings', 'source': 'composite', 'source-layer': 'building', 'type': 'fill-extrusion', 'filter': ['>', ['number', ['get', 'height'], 0], 4.7], 'paint': { 'fill-extrusion-color': '#ffffff', 'fill-extrusion-base': CONFIG.CITY.FLOAT_HEIGHT + 0.3, 'fill-extrusion-height': ["+", ["coalesce", ["get", "height"], 15], CONFIG.CITY.FLOAT_HEIGHT + 0.3], 'fill-extrusion-opacity': 1.0 } });
    
    await initSubway();
});

async function initSubway() {
    const clockEl = document.getElementById('clock');
    let selectedTid = null, activePopup = null;

    try {
        const [stopsT, stT, routesT, tripsT, subGeo] = await Promise.all([
            fetch('./stops.txt').then(r => r.text()), fetch('./stop_times.txt').then(r => r.text()), fetch('./routes.txt').then(r => r.text()), fetch('./trips.txt').then(r => r.text()), fetch('./sapporo_subway.geojson').then(r => r.json())
        ]);

        const stopMap = new Map(), stopFeatures = [];
        stopsT.split('\n').forEach(line => {
            const c = line.replace(/"/g, "").split(',');
            if (c.length < 4 || line.startsWith('stop_id')) return;
            const sid = c[0].trim(), sname = c[1].trim(), lon = parseFloat(c[3]), lat = parseFloat(c[2]);
            stopMap.set(sid, { sid, lon, lat, name: sname });
            stopFeatures.push({ type: 'Feature', properties: { name: sname }, geometry: { type: 'Point', coordinates: [lon, lat] } });
        });

        const routeData = new Map();
        routesT.split('\n').forEach(line => {
            const c = line.replace(/"/g, "").split(',');
            if (c.length < 7) return;
            const rName = c[3].split('（')[0].trim();
            routeData.set(c[0].trim(), { color: "#" + c[6].trim().toLowerCase(), name: rName });
        });

        const tripToRoute = new Map();
        tripsT.split('\n').forEach(line => {
            const c = line.replace(/"/g, "").split(',');
            if (c.length >= 3) tripToRoute.set(c[2].trim(), c[0].trim());
        });

        map.addSource('stops-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('trains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        // --- 全路線の3D線路（統合リボン）生成ロジック ---
        const shelterFeatures = [];
        subGeo.features.forEach(feature => {
            if (feature.geometry.type !== "LineString") return;
            const props = feature.properties;
            let sColor = "#666666"; // デフォルト
            if (props.name?.includes("東西線") || props.colour?.toLowerCase() === "#ff8c00") sColor = "#FF8C00";
            if (props.name?.includes("南北線") || props.colour?.toLowerCase() === "#008800") sColor = "#008800";
            if (props.name?.includes("東豊線") || props.colour?.toLowerCase() === "blue") sColor = "#0070C0";

            const turfLine = turf.lineString(feature.geometry.coordinates);
            const totalDist = turf.length(turfLine);
            const segmentLength = 0.03;

            for (let d = 0; d < totalDist; d += segmentLength) {
                const start = turf.along(turfLine, d), end = turf.along(turfLine, Math.min(d + segmentLength, totalDist));
                const getAlt = (pt) => {
                    const near = turf.nearestPoint(pt, { type: 'FeatureCollection', features: stopFeatures });
                    for (const key in STATION_ALTITUDE) { if (near.properties.name.includes(key)) return STATION_ALTITUDE[key]; }
                    return 0;
                };
                const midAlt = (getAlt(start) + getAlt(end)) / 2;
                const offsetL = turf.lineOffset(turf.lineString([start.geometry.coordinates, end.geometry.coordinates]), 0.0015, {units: 'kilometers'});
                const offsetR = turf.lineOffset(turf.lineString([start.geometry.coordinates, end.geometry.coordinates]), -0.0015, {units: 'kilometers'});
                const coords = [offsetL.geometry.coordinates[0], offsetL.geometry.coordinates[1], offsetR.geometry.coordinates[1], offsetR.geometry.coordinates[0], offsetL.geometry.coordinates[0]];
                shelterFeatures.push({ type: 'Feature', properties: { h_base: midAlt + 0.05, h_top: midAlt + 0.2, color: sColor }, geometry: { type: 'Polygon', coordinates: [coords] } });
            }
        });
        map.addSource('shelter-source', { type: 'geojson', data: { type: 'FeatureCollection', features: shelterFeatures } });

        map.addLayer({ 'id': 'stop-circles-3d', 'type': 'fill-extrusion', 'source': 'stops-source', 'paint': { 'fill-extrusion-color': '#cccccc', 'fill-extrusion-base': ['get', 'h_base'], 'fill-extrusion-height': ['get', 'h_top'], 'fill-extrusion-opacity': 0.5 } });
        for (let i = 0; i < 3; i++) {
            const off = (i % 2 === 0 ? 0.8 : -0.8) * Math.ceil(i / 2);
            map.addLayer({ 'id': `stop-circles-outline-${i}`, 'type': 'fill-extrusion', 'source': 'stops-source', 'paint': { 'fill-extrusion-color': '#000000', 'fill-extrusion-base': ['get', 'h_base'], 'fill-extrusion-height': ['+', ['get', 'h_base'], 0.05], 'fill-extrusion-opacity': 0.9, 'fill-extrusion-translate': [off, off], 'fill-extrusion-translate-anchor': 'viewport' } });
        }
        map.addLayer({ 'id': 'stop-labels', 'type': 'symbol', 'source': 'stops-source', 'layout': { 'text-field': ['get', 'name'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': ['case', ['==', ['get', 'h_base'], 25], ['literal', [0, -4.5]], ['literal', [0, 1.5]]] }, 'paint': { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1 } });
        map.addLayer({ 'id': 'tr-layer', 'type': 'fill-extrusion', 'source': 'trains', 'paint': { 'fill-extrusion-color': ['get', color], 'fill-extrusion-height': ['get', 'h_top'], 'fill-extrusion-base': ['get', 'h_base'], 'fill-extrusion-opacity': 1.0 } });
        map.addLayer({ 'id': 'shelter-layer', 'type': 'fill-extrusion', 'source': 'shelter-source', 'paint': { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-base': ['get', 'h_base'], 'fill-extrusion-height': ['get', 'h_top'], 'fill-extrusion-opacity': 0.8 } }, 'tr-layer');

        const activeTrips = new Map(), allStopTimes = new Map();
        const targetDay = (new Date().getDay() === 0 || new Date().getDay() === 6) ? "土休日" : "平日";
        stT.split('\n').forEach(line => {
            if (!line.includes(targetDay)) return;
            const c = line.replace(/"/g, "").split(',');
            if (c.length < 5 || line.startsWith('trip_id')) return;
            const tid = c[0].trim(), arrivalTime = c[1].trim().substring(0, 5), sid = c[3].trim(), sname = stopMap.get(sid)?.name || "不明な駅";
            const t = c[1].split(':'), sec = (parseInt(t[0])||0)*3600 + (parseInt(t[1])||0)*60 + (parseInt(t[2])||0);
            if (!activeTrips.has(tid)) activeTrips.set(tid, []);
            activeTrips.get(tid).push({ sec, sid, time: arrivalTime });
            if (!allStopTimes.has(tid)) allStopTimes.set(tid, []);
            allStopTimes.get(tid).push({ time: arrivalTime, name: sname });
        });

        map.on('click', 'tr-layer', (e) => {
            const f = e.features[0], tid = f.properties.tid, rid = tripToRoute.get(tid);
            const info = routeData.get(rid) || { name: tid.includes("N")?"南北線":tid.includes("T")?"東西線":"東豊線", color: f.properties.color };
            const panel = document.getElementById('panel'), titleEl = document.getElementById('panel-title'), timetableEl = document.getElementById('timetable');
            titleEl.innerHTML = `<div class="line-strip" style="background-color: ${info.color};"></div><span>${info.name}</span>`;
            timetableEl.innerHTML = `<div id="progress-line"></div><div id="pulsating-dot"></div>`;
            (allStopTimes.get(tid) || []).forEach(s => {
                const item = document.createElement('div');
                item.className = 'station-item';
                item.innerHTML = `<span class="station-time">${s.time}</span><span class="station-name">${s.name}</span>`;
                timetableEl.appendChild(item);
            });
            const dot = document.getElementById('pulsating-dot'), line = document.getElementById('progress-line');
            if(dot) dot.style.display = 'block';
            if(line) { line.style.backgroundColor = info.color; line.style.height = '0px'; }
            panel.classList.add('active');
            if (activePopup) activePopup.remove();
            activePopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 20 }).setLngLat(e.lngLat).setHTML('<div id="popup-dynamic-content"></div>').addTo(map);
        });

        map.on('click', (e) => { if (!map.queryRenderedFeatures(e.point, { layers: ['tr-layer'] }).length) { selectedTid = null; if (activePopup) activePopup.remove(); document.getElementById('panel').classList.remove('active'); } });
        map.on('mouseenter', 'tr-layer', () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', 'tr-layer', () => map.getCanvas().style.cursor = '');

        // ★吸着復活：GeoJSONのカーブに沿って走るロジック
        function getHybridPos(p1, p2, pct) {
            const lerpLng = p1.lon + (p2.lon - p1.lon) * pct, lerpLat = p1.lat + (p2.lat - p1.lat) * pct;
            const pt = turf.point([lerpLng, lerpLat]);
            let closestPt = pt, min_dist = Infinity;
            subGeo.features.forEach(f => {
                try {
                    const snapped = turf.nearestPointOnLine(f, pt);
                    if (snapped.properties.dist < min_dist) { min_dist = snapped.properties.dist; closestPt = snapped; }
                } catch(e) {}
            });
            const angle = Math.atan2(p2.lat - p1.lat, p2.lon - p1.lon);
            return { lng: closestPt.geometry.coordinates[0], lat: closestPt.geometry.coordinates[1], angle: angle };
        }

        function animate() {
            const now = new Date();
            const s = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds() + (now.getMilliseconds() / 1000);
            const scale = Math.min(15.0, Math.pow(2.2, Math.max(0, 16.0 - map.getZoom())));
            const latCorrection = 1 / Math.cos(map.getCenter().lat * Math.PI / 180);

            const stopFeats = [];
            stopMap.forEach(val => {
                let alt = 0; for (const k in STATION_ALTITUDE) if (val.name.includes(k)) alt = STATION_ALTITUDE[k];
                stopFeats.push(turf.circle([val.lon, val.lat], (CONFIG.TRAIN.LENGTH * scale) * 111320 * 1.5, { units: 'meters', steps: 32, properties: { name: val.name, h_base: alt, h_top: alt + 0.1 } }));
            });
            if (map.getSource('stops-source')) map.getSource('stops-source').setData({ type: 'FeatureCollection', features: stopFeats });

            const trainFeats = [];
            activeTrips.forEach((stops, tid) => {
                const rid = tripToRoute.get(tid), info = routeData.get(rid); if (!info) return;
                let hBaseLayer = info.name.includes("南北線") ? 0.3 : (info.name.includes("東西線") ? 0.2 : 0.1);
                for (let i = 0; i < stops.length - 1; i++) {
                    const c = stops[i], n = stops[i+1];
                    if (s >= c.sec && s < n.sec) {
                        const p1 = stopMap.get(c.sid), p2 = stopMap.get(n.sid); if (!p1 || !p2) continue;
                        const pct = Math.max(0, Math.min(1.0, (s - (c.sec + CONFIG.TRAIN.STOP_DURATION)) / Math.max(1, (n.sec - c.sec) - CONFIG.TRAIN.STOP_DURATION)));
                        let a1 = 0, a2 = 0; for (const k in STATION_ALTITUDE) { if (p1.name.includes(k)) a1 = STATION_ALTITUDE[k]; if (p2.name.includes(k)) a2 = STATION_ALTITUDE[k]; }
                        const curAlt = a1 + (a2 - a1) * pct;
                        const pos = getHybridPos(p1, p2, pct);
                        const cA = Math.cos(pos.angle), sA = Math.sin(pos.angle), L = CONFIG.TRAIN.LENGTH * scale, W = CONFIG.TRAIN.WIDTH * scale;
                        const corners = [[-L,-W],[L,-W],[L,W],[-L,W],[-L,-W]].map(p => [pos.lng + (p[0] * cA - p[1] * sA) * latCorrection, pos.lat + (p[0] * sA + p[1] * cA)]);
                        
                        if (tid === selectedTid && activePopup) {
                            activePopup.setLngLat([pos.lng, pos.lat]);
                            const isSt = (s - c.sec) < CONFIG.TRAIN.STOP_DURATION;
                            const popupDiv = document.getElementById('popup-dynamic-content');
                            if (popupDiv) popupDiv.parentElement.innerHTML = `<div id="popup-dynamic-content" style="display:flex; align-items:center; min-width:140px; font-family:sans-serif;"><div style="width:4px; height:40px; background:${info.color}; margin-right:12px; border-radius:2px;"></div><div><div style="font-weight:bold; font-size:14px; color:#333;">${info.name}</div><div style="font-size:11px; margin-top:3px; color:#666;">${isSt ? `停車：<b>${p1.name}</b>` : `前駅：${p1.name}`}<br>次駅：<b>${p2.name}</b> ${n.time}</div></div></div>`;
                            const dot = document.getElementById('pulsating-dot'), line = document.getElementById('progress-line');
                            if (dot && line) { const top = (i * 45) + (pct * 45) + 32; dot.style.top = `${top-6}px`; line.style.height = `${top-32}px`; dot.style.display = 'block'; }
                        }
                        trainFeats.push({ type: 'Feature', properties: { tid, color: info.color, h_base: hBaseLayer + curAlt, h_top: hBaseLayer + currentAlt + (CONFIG.TRAIN.HEIGHT * scale) }, geometry: { type: 'Polygon', coordinates: [corners] } });
                        break;
                    }
                }
            });
            if (map.getSource('trains')) map.getSource('trains').setData({ type: 'FeatureCollection', features: trainFeats });
            requestAnimationFrame(animate);
        }
        animate();
    } catch (e) { console.error(e); }
}
