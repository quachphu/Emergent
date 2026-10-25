import "leaflet/dist/leaflet.css";
import "mapbox-gl/dist/mapbox-gl.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { GeoPoint } from "@/lib/types";
import { cn, prefersReducedMotion } from "@/lib/utils";
import { SchematicRoute } from "./SchematicRoute";

export { SchematicRoute };

type LngLat = [number, number];

export function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Slightly curved arc between two points (for the route line). */
export function arc(a: LngLat, b: LngLat, steps = 64): LngLat[] {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = mx - dy * 0.18;
  const cy = my + dx * 0.18;
  const pts: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([(1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2, (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2]);
  }
  return pts;
}

const pinIcon = (color: string, label?: string) =>
  L.divIcon({
    className: "",
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    popupAnchor: [0, -30],
    html: `<div style="display:grid;place-items:center;width:28px;height:28px;border-radius:999px;background:${color};border:3px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.25);color:#fff;font:600 12px Inter Variable,sans-serif">${label ?? ""}</div><div style="width:2px;height:8px;margin:-1px auto 0;background:${color}"></div>`,
  });

function FitBounds({ points }: { points: LngLat[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const b = L.latLngBounds(points.map(([lng, lat]) => [lat, lng] as [number, number]));
    map.fitBounds(b, { padding: [48, 48], maxZoom: 14 });
  }, [map, points]);
  return null;
}

export interface Pin {
  id: string;
  kind: string;
  lng: number;
  lat: number;
  title: string;
  subtitle?: string;
  color: string;
  label?: string;
}

export function tileUrl(token?: string | null, dark?: boolean) {
  if (token) return `https://api.mapbox.com/styles/v1/mapbox/${dark ? "dark-v11" : "light-v11"}/tiles/256/{z}/{x}/{y}@2x?access_token=${token}`;
  return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
}

export function PinMap({ pins, token, route, className, dark, controls = true, onTiles }: { pins: Pin[]; token?: string | null; route?: [LngLat, LngLat]; className?: string; dark?: boolean; controls?: boolean; onTiles?: (ok: boolean) => void }) {
  const points = useMemo(() => pins.map((p) => [p.lng, p.lat] as LngLat).concat(route ? route : []), [pins, route]);
  const center: [number, number] = points.length ? [points[0][1], points[0][0]] : [37.7749, -122.4194];
  return (
    <div className={cn("relative overflow-hidden rounded-card border border-border", className)}>
      <MapContainer center={center} zoom={12} scrollWheelZoom={controls} zoomControl={controls} className="h-full w-full" attributionControl>
        <TileLayer
          eventHandlers={{ tileload: () => onTiles?.(true), tileerror: () => onTiles?.(false) }}
          url={tileUrl(token, dark)}
          attribution={token ? '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © OpenStreetMap' : "© OpenStreetMap contributors"}
        />
        {route && <Polyline positions={arc(route[0], route[1]).map(([lng, lat]) => [lat, lng])} pathOptions={{ color: "#FF6600", weight: 4, dashArray: "8 8" }} />}
        {pins.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={pinIcon(p.color, p.label)}>
            <Popup>
              <div className="text-[13px] font-semibold">{p.title}</div>
              {p.subtitle && <div className="text-[12px] text-ink-2">{p.subtitle}</div>}
            </Popup>
          </Marker>
        ))}
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
}

/**
 * 3D fly-through from the old address to the new one (Mapbox GL, 3D buildings, pitch/bearing),
 * falling back to a 2D map without a token / WebGL / with reduced motion, and to a schematic
 * drawing if no tiles load.
 */
export function FlyThrough({ from, to, work, token, onDone, play = true, fromLabel, toLabel }: { from: GeoPoint; to: GeoPoint; work?: GeoPoint; token?: string | null; onDone?: () => void; play?: boolean; fromLabel?: string; toLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"3d" | "2d" | "schematic">(() => (token && hasWebGL() && !prefersReducedMotion() ? "3d" : "2d"));
  const [loaded, setLoaded] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (mode !== "3d" || !ref.current || !token) return;
    let cancelled = false;
    let map: any;
    const timers: number[] = [];
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !ref.current) return;
      mapboxgl.accessToken = token;
      const a = from.coordinates as LngLat;
      const b = to.coordinates as LngLat;
      try {
        map = new mapboxgl.Map({
          container: ref.current,
          style: "mapbox://styles/mapbox/standard",
          center: a,
          zoom: 15.6,
          pitch: 62,
          bearing: -24,
          interactive: true,
          attributionControl: true,
          antialias: true,
        });
      } catch {
        setMode("2d");
        return;
      }
      const failTimer = window.setTimeout(() => !cancelled && !map.isStyleLoaded() && setMode("2d"), 7000);
      timers.push(failTimer);
      map.on("error", (e: any) => {
        if (!map.isStyleLoaded() && String(e?.error?.message || "").length) setMode("2d");
      });
      map.on("style.load", () => {
        if (cancelled) return;
        clearTimeout(failTimer);
        setLoaded(true);
        try {
          map.setConfigProperty?.("basemap", "lightPreset", "dusk");
        } catch {
          /* older styles */
        }
        map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: arc(a, b, 128) } } });
        map.addLayer({ id: "route-glow", type: "line", source: "route", paint: { "line-color": "#FF6600", "line-width": 14, "line-opacity": 0.25, "line-blur": 6 } });
        map.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#FF6600", "line-width": 4 }, layout: { "line-cap": "round" } });
        const el = (cls: string) => {
          const d = document.createElement("div");
          d.className = cls;
          return d;
        };
        new mapboxgl.Marker({ element: el("size-4 rounded-full border-[3px] border-white bg-ink shadow-lg") }).setLngLat(a).addTo(map);
        new mapboxgl.Marker({ element: el("size-5 rounded-full border-[3px] border-white bg-orange shadow-lg") }).setLngLat(b).addTo(map);
        if (work) new mapboxgl.Marker({ element: el("size-3.5 rounded-full border-2 border-white bg-[#2453B3] shadow") }).setLngLat(work.coordinates as LngLat).addTo(map);
        if (!play) {
          map.fitBounds([a, b], { padding: 80, pitch: 40, duration: 0 });
          return;
        }
        // Choreography: orbit the old home, climb out, cruise up the coast, descend into the new neighborhood.
        timers.push(window.setTimeout(() => map.easeTo({ bearing: 20, duration: 2600, easing: (t: number) => t }), 300));
        timers.push(window.setTimeout(() => map.flyTo({ center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom: 6.2, pitch: 35, bearing: -32, duration: 4200, curve: 1.6, essential: true }), 3000));
        timers.push(window.setTimeout(() => map.flyTo({ center: b, zoom: 15.8, pitch: 66, bearing: 28, duration: 5200, curve: 1.5, essential: true }), 7400));
        timers.push(window.setTimeout(() => map.easeTo({ bearing: 75, duration: 3500 }), 12800));
        timers.push(window.setTimeout(() => doneRef.current?.(), 16500));
      });
    })();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      try {
        map?.remove();
      } catch {
        /* ignore */
      }
    };
  }, [mode, token, from, to, work, play]);

  useEffect(() => {
    if (mode === "3d" || !play) return;
    const t = window.setTimeout(() => doneRef.current?.(), prefersReducedMotion() ? 2500 : 5000);
    return () => clearTimeout(t);
  }, [mode, play]);

  if (mode === "3d") {
    return (
      <div className="absolute inset-0">
        {!loaded && <SchematicRoute fromLabel={fromLabel} toLabel={toLabel} />}
        <div ref={ref} className="absolute inset-0" data-testid="map-3d" />
      </div>
    );
  }
  const pins: Pin[] = [
    { id: "from", kind: "home", lng: from.coordinates[0], lat: from.coordinates[1], title: fromLabel || "Old home", color: "#1F1E1B" },
    { id: "to", kind: "home", lng: to.coordinates[0], lat: to.coordinates[1], title: toLabel || "New home", color: "#FF6600" },
    ...(work ? [{ id: "work", kind: "work", lng: work.coordinates[0], lat: work.coordinates[1], title: "Work", color: "#2453B3" }] : []),
  ];
  return <Flat2D pins={pins} token={token} from={from} to={to} fromLabel={fromLabel} toLabel={toLabel} />;
}

function Flat2D({ pins, token, from, to, fromLabel, toLabel }: { pins: Pin[]; token?: string | null; from: GeoPoint; to: GeoPoint; fromLabel?: string; toLabel?: string }) {
  const [tiles, setTiles] = useState(false);
  return (
    <div className="absolute inset-0" data-testid="map-2d">
      {!tiles && <SchematicRoute fromLabel={fromLabel} toLabel={toLabel} />}
      <PinMap pins={pins} token={token} route={[from.coordinates as LngLat, to.coordinates as LngLat]} controls={false} onTiles={(ok) => ok && setTiles(true)}
        className={cn("absolute inset-0 rounded-none border-0 transition-opacity duration-700 [&_.leaflet-container]:!bg-transparent", tiles ? "opacity-90" : "opacity-0")} dark />
    </div>
  );
}
