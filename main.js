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

// ★南北線の高度設定：南平岸(N13)〜真駒内(N16)を25mに設定
const STATION_ALTITUDE = {
    "N13": 25, "N14": 25, "N15": 25, "N16": 25
};

map.on('load', async () => {
    // ベースマップの透明化処理
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

    // 1. 公園レイヤー
    map.addLayer({
        'id': 'floating-parks',
        'source': 'composite', 'source-layer': 'landuse', 'type': 'fill-extrusion',
        'filter': ['match', ['get', 'class'], ['park', 'grass', 'wood', 'scrub'], true, false],
        'paint': { 'fill-extrusion-color': '#ffffff', 'fill-extrusion-base': CONFIG.CITY.FLOAT_HEIGHT, 'fill-extrusion-height': CONFIG.CITY.FLOAT_HEIGHT + 0.1, 'fill-extrusion-opacity': 0.4 }
    });

    // 2. 川・水面レイヤー
    map.addLayer({
        'id': 'floating-water',
        'source': 'composite', 'source-layer': 'water', 'type': 'fill-extrusion',
        'paint': { 'fill-extrusion-color': '#b0c4de', 'fill-extrusion-base': CONFIG.CITY.FLOAT_HEIGHT + 0.1, 'fill-extrusion-height': CONFIG.CITY.FLOAT_HEIGHT + 0.2, 'fill-extrusion-opacity': 0.3 }
    });

    // 3. 道路レイヤー
    map.addLayer({
        'id': 'floating-roads',
        'source': 'composite', 'source-layer': 'road', 'type': 'line',
        'filter': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street'], true, false],
        'paint': { 'line-color': '#ffffff', 'line-width': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 8, ['secondary', 'tertiary'], 4, 2], 'line-opacity': 0.6 }
    });

    // 4. 建物レイヤー
    map.addLayer({
        'id': 'floating-buildings',
        'source': 'composite', 'source-layer': 'building', 'type': 'fill-extrusion',
        'filter': ['>', ['number', ['get', 'height'], 0], 4.7], 
        'paint': { 'fill-extrusion-color': '#ffffff', 'fill-extrusion-base': CONFIG.CITY.FLOAT_HEIGHT + 0.3, 'fill-extrusion-height': ["+", ["coalesce", ["get", "height"], 15], CONFIG.CITY.FLOAT_HEIGHT + 0.3], 'fill-extrusion-opacity': 1.0 }
    });
    
    await initSubway();
});

async function initSubway() {
    const dateEl = document.getElementById('date'), clockEl = document.getElementById('clock'), trainCountEl = document.getElementById('train-count');
    let selectedTid = null, activePopup = null;

    try {
        const [stopsT, stT, routesT, tripsT, subGeo] = await Promise.all([
            fetch('./stops.txt').then(r => r.text()), fetch('./stop_times.txt').then(r => r.text()), fetch('./routes.txt').then(r => r.text()), fetch('./trips.txt').then(r => r.text()), fetch('./sapporo_subway.geojson').then(r => r.json())
        ]);

        const stopMap = new Map();
        const stopFeatures = [];
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

        map.addSource('rail', { type: 'geojson', data: subGeo });
        map.addSource('stops-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('trains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        map.addLayer({ 'id': 'rail-line', 'type': 'line', 'source': 'rail', 'paint': { 'line-color': ['get', 'colour'], 'line-width': 3, 'line-opacity': 0.6 } });
        map.addLayer({ 'id': 'stop-circles-3d', 'type': 'fill-extrusion', 'source': 'stops-source', 'paint': { 'fill-extrusion-color': '#cccccc', 'fill-extrusion-base': ['get', 'h_base'], 'fill-extrusion-height': ['get', 'h_top'], 'fill-extrusion-opacity': 0.5 } });
        map.addLayer({ 'id': 'stop-circles-outline', 'type': 'line', 'source': 'stops-source', 'paint': { 'line-color': '#000000', 'line-width': 2 } });
        map.addLayer({ 'id': 'stop-labels', 'type': 'symbol', 'source': 'stops-source', 'layout': { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top' }, 'paint': { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1 } });
        map.addLayer({ 'id': 'tr-layer', 'type': 'fill-extrusion', 'source': 'trains', 'paint': { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h_top'], 'fill-extrusion-base': ['get', 'h_base'], 'fill-extrusion-opacity': 1.0 } });

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

        // クリックイベント
        map.on('click', 'tr-layer', (e) => {
            const f = e.features[0];
            selectedTid = f.properties.tid;
            const rid = tripToRoute.get(selectedTid);
            const info = routeData.get(rid) || { name: selectedTid.includes("N") ? "南北線" : (selectedTid.includes("T") ? "東西線" : "東豊線"), color: f.properties.color || "#666" };
            const panel = document.getElementById('panel'), titleEl = document.getElementById('panel-title'), timetableEl = document.getElementById('timetable');
            titleEl.innerHTML = `<div class="line-strip" style="background-color: ${info.color};"></div><span>${info.name}</span>`;
            timetableEl.innerHTML = `<div id="progress-line"></div><div id="pulsating-dot"></div>`;
            const stops = allStopTimes.get(selectedTid) || [];
            stops.forEach(s => {
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
            activePopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 20 }).setLngLat(e.lngLat).setHTML('<div id="popup-dynamic-content">読み込み中...</div>').addTo(map);
        });

        map.on('click', (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: ['tr-layer'] });
            if (!features.length) {
                selectedTid = null;
                if (activePopup) { activePopup.remove(); activePopup = null; }
                const panel = document.getElementById('panel');
                if (panel) panel.classList.remove('active');
            }
        });

        map.on('mouseenter', 'tr-layer', () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', 'tr-layer', () => map.getCanvas().style.cursor = '');

        // 補助関数群
        function isCriticalSection(n1, n2) {
            const pairs = [["さっぽろ", "大通"], ["大通", "すすきの"], ["大通", "豊水すすきの"], ["大通", "西１１丁目"], ["大通", "西11丁目"], ["大通", "バスセンター前"]];
            return pairs.some(p => (n1.includes(p[0]) && n2.includes(p[1])) || (n1.includes(p[1]) && n2.includes(p[0])));
        }

        function getHybridPos(p1, p2, pct) {
            const lerpLng = p1.lon + (p2.lon - p1.lon) * pct, lerpLat = p1.lat + (p2.lat - p1.lat) * pct;
            const pt = turf.point([lerpLng, lerpLat]);
            const straightAngle = Math.atan2(p2.lat - p1.lat, p2.lon - p1.lon);
            let closestPt = pt, min_dist = Infinity, bestFeature = null;
            subGeo.features.forEach(f => {
                try {
                    const snapped = turf.nearestPointOnLine(f, pt);
                    if (snapped.properties.dist < min_dist) { min_dist = snapped.properties.dist; closestPt = snapped; bestFeature = f; }
                } catch(e) {}
            });
            let snappedLng = closestPt.geometry.coordinates[0], snappedLat = closestPt.geometry.coordinates[1], snappedAngle = straightAngle;
            if (bestFeature && min_dist < 0.5) { 
                const nPct = Math.min(1.0, pct + 0.005);
                const nSnapped = turf.nearestPointOnLine(bestFeature, turf.point([p1.lon + (p2.lon - p1.lon) * nPct, p1.lat + (p2.lat - p1.lat) * nPct]));
                snappedAngle = (90 - turf.bearing(closestPt, nSnapped)) * (Math.PI / 180);
            }
            const threshold = 0.005, deadzone = 0.003;
            const distFromStart = turf.distance(turf.point([p1.lon, p1.lat]), pt);
            const totalDist = turf.distance(turf.point([p1.lon, p1.lat]), turf.point([p2.lon, p2.lat]));
            let currentDist = Math.min(distFromStart, totalDist - distFromStart);
            if (currentDist < deadzone || isCriticalSection(p1.name, p2.name)) return { lng: lerpLng, lat: lerpLat, angle: straightAngle };
            else if (currentDist < threshold) {
                const w = 1.0 - (currentDist - deadzone) / (threshold - deadzone);
                return { lng: snappedLng + (lerpLng - snappedLng) * w, lat: snappedLat + (lerpLat - snappedLat) * w, angle: snappedAngle + (straightAngle - snappedAngle) * w };
            }
            return { lng: snappedLng, lat: snappedLat, angle: snappedAngle };
        }

        function animate() {
            const now = new Date();
            if (dateEl) {
                const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate(), w = ["日", "月", "火", "水", "木", "金", "土"][now.getDay()];
                dateEl.innerText = `${y}年${m}月${d}日(${w})`; 
            }
            clockEl.innerText = now.toLocaleTimeString('ja-JP', { hour12: false });
            const s = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds() + (now.getMilliseconds() / 1000);
            
            const z = map.getZoom(), center = map.getCenter();
            const latCorrection = 1 / Math.cos(center.lat * Math.PI / 180);
            const scale = Math.min(15.0, Math.pow(2.2, Math.max(0, 16.0 - z))); 
            
            const circleRadiusMeters = (CONFIG.TRAIN.LENGTH * scale) * 111320 * 1.5; 
            const stopFeats = [];
            stopMap.forEach((val) => {
                const alt = STATION_ALTITUDE[val.sid] || 0;
                const circle = turf.circle([val.lon, val.lat], circleRadiusMeters, { units: 'meters', steps: 32, properties: { name: val.name, h_base: alt, h_top: alt + 0.1 } });
                stopFeats.push(circle);
            });
            if (map.getSource('stops-source')) map.getSource('stops-source').setData({ type: 'FeatureCollection', features: stopFeats });

            const hScale = scale, L = CONFIG.TRAIN.LENGTH * scale, W = CONFIG.TRAIN.WIDTH * scale;
            const trainFeats = [];

            activeTrips.forEach((stops, tid) => {
                const rid = tripToRoute.get(tid), info = routeData.get(rid);
                if (!info) return;
                let hBaseLayer = info.name.includes("南北線") ? 7 : (info.name.includes("東西線") ? 4 : 1);

                for (let i = 0; i < stops.length - 1; i++) {
                    const c = stops[i], n = stops[i+1];
                    if (s >= c.sec && s < n.sec) {
                        const p1 = stopMap.get(c.sid), p2 = stopMap.get(n.sid);
                        if (!p1 || !p2) continue;
                        
                        const travelTime = (n.sec - c.sec) - CONFIG.TRAIN.STOP_DURATION;
                        const elapsed = s - (c.sec + CONFIG.TRAIN.STOP_DURATION);
                        const pct = Math.max(0, Math.min(1.0, elapsed / Math.max(1, travelTime)));
                        
                        // 高度計算
                        const alt1 = STATION_ALTITUDE[p1.sid] || 0;
                        const alt2 = STATION_ALTITUDE[p2.sid] || 0;
                        const currentAlt = alt1 + (alt2 - alt1) * pct;

                        const pos = getHybridPos(p1, p2, pct);
                        const cA = Math.cos(pos.angle), sA = Math.sin(pos.angle);
                        const corners = [[-L,-W],[L,-W],[L,W],[-L,W],[-L,-W]].map(p => [pos.lng + (p[0] * cA - p[1] * sA) * latCorrection, pos.lat + (p[0] * sA + p[1] * cA)]);
                        
                        if (tid === selectedTid && activePopup) {
                            activePopup.setLngLat([pos.lng, pos.lat]);
                            const isStopped = (s - c.sec) < CONFIG.TRAIN.STOP_DURATION;
                            const statusHtml = isStopped ? `停車：<b>${p1.name}</b> ${c.time}<br>次駅：${p2.name} ${n.time}` : `前駅：${p1.name} ${c.time}<br>次駅：<b>${p2.name}</b> ${n.time}`;
                            const content = `<div id="popup-dynamic-content" style="display:flex; align-items:center; min-width:140px; font-family:sans-serif;"><div style="width:4px; height:40px; background:${info.color}; margin-right:12px; border-radius:2px;"></div><div><div style="font-weight:bold; font-size:14px; color:#333;">${info.name}</div><div style="font-size:11px; margin-top:3px; color:#666; line-height:1.4;">${statusHtml}</div></div></div>`;
                            const popupDiv = document.getElementById('popup-dynamic-content');
                            if (popupDiv) popupDiv.parentElement.innerHTML = content;
                            const dot = document.getElementById('pulsating-dot'), line = document.getElementById('progress-line');
                            if (dot && line) { const itemHeight = 45, offset = 32, currentTop = (i * itemHeight) + (pct * itemHeight) + offset; dot.style.top = `${currentTop - 6}px`; line.style.height = `${currentTop - offset}px`; dot.style.display = 'block'; }
                        }

                        trainFeats.push({ 
                            type: 'Feature', 
                            properties: { tid: tid, color: info.color, h_base: hBaseLayer + currentAlt, h_top: hBaseLayer + currentAlt + (CONFIG.TRAIN.HEIGHT * hScale) }, 
                            geometry: { type: 'Polygon', coordinates: [corners] } 
                        });
                        break;
                    }
                }
            });
            if (map.getSource('trains')) map.getSource('trains').setData({ type: 'FeatureCollection', features: trainFeats });
            trainCountEl.innerText = `${trainFeats.length} trains running`;
            requestAnimationFrame(animate);
        }
        animate();
    } catch (e) { console.error(e); }
}
