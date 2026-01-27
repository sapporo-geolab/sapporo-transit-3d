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

map.on('load', async () => {
    // ベースマップの透明化処理（既存のコードと同じ）
    const layers = map.getStyle().layers;
    layers.forEach(layer => {
        if (layer.id !== 'background') {
            if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-opacity', 0);
            if (layer.type === 'line') map.setPaintProperty(layer.id, 'line-opacity', 0);
            if (layer.type === 'symbol') map.setPaintProperty(layer.id, 'text-opacity', 0);
            if (layer.type === 'circle') map.setPaintProperty(layer.id, 'circle-opacity', 0);
        } else {
            // 背景が明るい方が良い場合は、ここを '#ffffff' や '#f0f0f0' に変更してください
            map.setPaintProperty('background', 'background-color', '#111111');
        }
    });

    // --- 各レイヤーのベース高さを 0.1m ずつずらして重なりを解消 (Z-fighting防止) ---

// 1. 公園レイヤー（色をはっきり：不透明度 0.6）
map.addLayer({
    'id': 'floating-parks',
    'source': 'composite', 'source-layer': 'landuse', 'type': 'fill-extrusion',
    'filter': ['match', ['get', 'class'], ['park', 'grass', 'wood', 'scrub'], true, false],
    'paint': {
        'fill-extrusion-color': '#a3ad85', 
        'fill-extrusion-base': CONFIG.CITY.FLOAT_HEIGHT, 
        'fill-extrusion-height': CONFIG.CITY.FLOAT_HEIGHT + 0.1, 
        'fill-extrusion-opacity': 0.6 // 色がしっかり見えるようにアップ
    }
});

// 2. 川・水面レイヤー（色をはっきり：不透明度 0.5）
map.addLayer({
    'id': 'floating-water',
    'source': 'composite', 'source-layer': 'water', 'type': 'fill-extrusion',
    'paint': {
        'fill-extrusion-color': '#b0c4de', 
        'fill-extrusion-base': CONFIG.CITY.FLOAT_HEIGHT + 0.1,
        'fill-extrusion-height': CONFIG.CITY.FLOAT_HEIGHT + 0.2,
        'fill-extrusion-opacity': 0.5 // 存在感が出るようにアップ
    }
});

// 3. 道路レイヤー（幅に強弱をつけ、色を薄くした設定）
map.addLayer({
    'id': 'floating-roads',
    'source': 'composite', 'source-layer': 'road', 'type': 'line',
    'filter': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street'], true, false],
    'paint': {
        // 色を濃い朱色から、淡いパステルオレンジ (#ffcc80) に変更
        'line-color': '#ffcc80',
        
        // 道路の種別によって太さを分ける設定
        'line-width': [
            'match',
            ['get', 'class'],
            ['motorway', 'trunk', 'primary'], 6,    // 太い道路（高速・国道など）
            ['secondary', 'tertiary'], 3,          // 中間の道路
            1.5                                   // 細い道路（一般道：street）
        ],
        
        // 背景の黒に馴染みつつ、存在感が出るように透明度を調整
        'line-opacity': 0.7 
    }
});

// 4. 建物レイヤー（完全に不透明な白い都市）
map.addLayer({
    'id': 'floating-buildings',
    'source': 'composite', 'source-layer': 'building', 'type': 'fill-extrusion',
    'filter': ['>=', ['get', 'height'], 3], 
    'paint': {
        // 色は純白を維持
        'fill-extrusion-color': '#ffffff',
        'fill-extrusion-base': CONFIG.CITY.FLOAT_HEIGHT + 0.3, 
        // 高さを元のスケールに設定
        'fill-extrusion-height': ["+", ["get", "height"], CONFIG.CITY.FLOAT_HEIGHT + 0.3],
        // 透明度を 0（不透明）にするため、値を 1.0 に設定
        'fill-extrusion-opacity': 1.0 
    }
});
    
    await initSubway();
});

async function initSubway() {
    const clockEl = document.getElementById('clock');
    const trainCountEl = document.getElementById('train-count');

    try {
        const [stopsT, stT, routesT, tripsT, subGeo] = await Promise.all([
            fetch('./stops.txt').then(r => r.text()),
            fetch('./stop_times.txt').then(r => r.text()),
            fetch('./routes.txt').then(r => r.text()),
            fetch('./trips.txt').then(r => r.text()),
            fetch('./sapporo_subway.geojson').then(r => r.json())
        ]);

        const stopMap = new Map();
        const stopFeatures = [];
        stopsT.split('\n').forEach(line => {
            const c = line.replace(/"/g, "").split(',');
            if (c.length < 4 || line.startsWith('stop_id')) return;
            const sid = c[0].trim(), sname = c[1].trim();
            const lon = parseFloat(c[3]), lat = parseFloat(c[2]);
            stopMap.set(sid, { lon, lat, name: sname });
            stopFeatures.push({
                type: 'Feature', properties: { name: sname },
                geometry: { type: 'Point', coordinates: [lon, lat] }
            });
        });

        const routeData = new Map();
        routesT.split('\n').forEach(line => {
            const c = line.replace(/"/g, "").split(',');
            if (c.length < 7) return;
            routeData.set(c[0].trim(), { color: "#" + c[6].trim().toLowerCase(), name: c[2].trim() });
        });

        const tripToRoute = new Map();
        tripsT.split('\n').forEach(line => {
            const c = line.replace(/"/g, "").split(',');
            if (c.length >= 3) tripToRoute.set(c[2].trim(), c[0].trim());
        });

        // 路線の描画（空中都市を際立たせるため、少し光るような設定に）
        map.addSource('rail', { type: 'geojson', data: subGeo });
        map.addLayer({ 'id': 'rail-line', 'type': 'line', 'source': 'rail', 'paint': { 'line-color': ['get', 'colour'], 'line-width': 3, 'line-opacity': 0.6 } });
        
        // 駅の描画
        map.addSource('stops-source', { type: 'geojson', data: { type: 'FeatureCollection', features: stopFeatures } });
        map.addLayer({ 'id': 'stop-circles', 'type': 'circle', 'source': 'stops-source', 'paint': { 'circle-radius': 4, 'circle-color': '#ffffff' } });
        map.addLayer({ 'id': 'stop-labels', 'type': 'symbol', 'source': 'stops-source', 'layout': { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top' }, 'paint': { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1 } });

        map.addSource('trains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 'id': 'tr-layer', 'type': 'fill-extrusion', 'source': 'trains', 'paint': { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h_top'], 'fill-extrusion-base': ['get', 'h_base'], 'fill-extrusion-opacity': 1.0 } });

        const activeTrips = new Map();
        const targetDay = (new Date().getDay() === 0 || new Date().getDay() === 6) ? "土休日" : "平日";
        stT.split('\n').forEach(line => {
            if (!line.includes(targetDay)) return;
            const c = line.replace(/"/g, "").split(',');
            if (c.length < 5 || line.startsWith('trip_id')) return;
            const tid = c[0].trim(), t = c[1].split(':'), sec = (parseInt(t[0])||0)*3600 + (parseInt(t[1])||0)*60 + (parseInt(t[2])||0);
            if (!activeTrips.has(tid)) activeTrips.set(tid, []);
            activeTrips.get(tid).push({ sec, sid: c[3].trim() });
        });

        function isCriticalSection(n1, n2) {
            const pairs = [["さっぽろ", "大通"], ["大通", "すすきの"], ["大通", "豊水すすきの"], ["大通", "西１１丁目"], ["大通", "西11丁目"], ["大通", "バスセンター前"]];
            return pairs.some(p => (n1.includes(p[0]) && n2.includes(p[1])) || (n1.includes(p[1]) && n2.includes(p[0])));
        }

function getHybridPos(p1, p2, pct) {
    const lerpLng = p1.lon + (p2.lon - p1.lon) * pct;
    const lerpLat = p1.lat + (p2.lat - p1.lat) * pct;
    const pt = turf.point([lerpLng, lerpLat]);
    const straightAngle = Math.atan2(p2.lat - p1.lat, p2.lon - p1.lon);
    
    const distFromStart = turf.distance(turf.point([p1.lon, p1.lat]), pt);
    const totalDist = turf.distance(turf.point([p1.lon, p1.lat]), turf.point([p2.lon, p2.lat]));

    // --- 1. まず線路上の「スナップ座標」と「角度」を取得する ---
    let closestPt = pt, min_dist = Infinity, bestFeature = null;
    subGeo.features.forEach(f => {
        try {
            const snapped = turf.nearestPointOnLine(f, pt);
            if (snapped.properties.dist < min_dist) { 
                min_dist = snapped.properties.dist; 
                closestPt = snapped; 
                bestFeature = f; 
            }
        } catch(e) {}
    });

    let snappedLng = closestPt.geometry.coordinates[0];
    let snappedLat = closestPt.geometry.coordinates[1];
    let snappedAngle = straightAngle; // デフォルト

    if (bestFeature && min_dist < 0.5) { 
        const nPct = Math.min(1.0, pct + 0.005);
        const nSnapped = turf.nearestPointOnLine(bestFeature, turf.point([p1.lon + (p2.lon - p1.lon) * nPct, p1.lat + (p2.lat - p1.lat) * nPct]));
        snappedAngle = (90 - turf.bearing(closestPt, nSnapped)) * (Math.PI / 180);
    }

    // --- 2. 駅付近での「滑らかな合成」ロジック ---
    const threshold = 0.005; // 5m手前から合成開始
    const deadzone = 0.003;  // 3m以内は完全に直線

    let currentDist = Math.min(distFromStart, totalDist - distFromStart);

    if (currentDist < deadzone || isCriticalSection(p1.name, p2.name)) {
        // 3m以内は完全な直線補正
        return { lng: lerpLng, lat: lerpLat, angle: straightAngle };
    } else if (currentDist < threshold) {
        // 3mから5mの間で、線路の動き(w=0)から直線の動き(w=1)へ徐々に移行
        const w = 1.0 - (currentDist - deadzone) / (threshold - deadzone);
        return {
            lng: snappedLng + (lerpLng - snappedLng) * w,
            lat: snappedLat + (lerpLat - snappedLat) * w,
            angle: snappedAngle + (straightAngle - snappedAngle) * w
        };
    }

    // それ以外（駅間）は通常の線路スナップ
    return { lng: snappedLng, lat: snappedLat, angle: snappedAngle };
}
        function animate() {
            const now = new Date();
            const s = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds() + (now.getMilliseconds() / 1000);
            clockEl.innerText = now.toLocaleTimeString('ja-JP', { hour12: false });
            
            const z = map.getZoom(), scale = Math.pow(3.0, Math.max(0, 14.5 - z)); 
            const L = CONFIG.TRAIN.LENGTH * scale, W = CONFIG.TRAIN.WIDTH * scale, hScale = Math.pow(1.5, Math.max(0, 14.5 - z));

            const feats = [];
            activeTrips.forEach((stops, tid) => {
                const rid = tripToRoute.get(tid), info = routeData.get(rid);
                if (!info) return;
                let hBase = info.name.includes("南北線") ? 7 : (info.name.includes("東西線") ? 4 : 1);

                for (let i = 0; i < stops.length - 1; i++) {
                    const c = stops[i], n = stops[i+1];
                    if (s >= c.sec && s < n.sec) {
                        const p1 = stopMap.get(c.sid), p2 = stopMap.get(n.sid);
                        if (!p1 || !p2) continue;
                        const pos = getHybridPos(p1, p2, Math.min(1.0, (s - c.sec) / Math.max(1, (n.sec - c.sec) - CONFIG.TRAIN.STOP_DURATION)));
                        const cA = Math.cos(pos.angle), sA = Math.sin(pos.angle);
                        const corners = [[-L,-W],[L,-W],[L,W],[-L,W],[-L,-W]].map(p => [pos.lng + (p[0]*cA-p[1]*sA), pos.lat + (p[0]*sA+p[1]*cA)]);
                        feats.push({ type: 'Feature', properties: { color: info.color, h_base: hBase, h_top: hBase + (CONFIG.TRAIN.HEIGHT * hScale) }, geometry: { type: 'Polygon', coordinates: [corners] } });
                        break;
                    }
                }
            });
            if (map.getSource('trains')) map.getSource('trains').setData({ type: 'FeatureCollection', features: feats });
            trainCountEl.innerText = `${feats.length} trains running`;
            requestAnimationFrame(animate);
        }
        animate();
    } catch (e) { console.error(e); }

}
















