import * as THREE from "./vendor/three.module.js";

const host = document.querySelector("#liquid-background");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

try {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    powerPreference: "low-power"
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const pointerTarget = new THREE.Vector2(0.5, 0.5);
  const pointer = new THREE.Vector2(0.5, 0.5);

  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2() },
    uPointer: { value: pointer },
    uIron: { value: 0 }
  };

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms,
    vertexShader: `
      void main() {
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec2 uPointer;
      uniform float uIron;

      float blob(vec2 uv, vec2 center, float radius) {
        float d = length(uv - center);
        return radius * radius / max(d * d, 0.002);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / uResolution.xy;
        float aspect = uResolution.x / uResolution.y;
        vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
        float t = uTime * 0.18;

        p.x += sin(p.y * 5.0 + t * 1.6) * 0.025;
        p.y += cos(p.x * 4.0 - t * 1.3) * 0.022;

        vec2 mouse = vec2((uPointer.x - 0.5) * aspect, uPointer.y - 0.5);
        float field = 0.0;
        field += blob(p, vec2(-0.48 + sin(t) * 0.15, 0.30 + cos(t * 1.3) * 0.10), 0.19);
        field += blob(p, vec2(0.43 + cos(t * 0.8) * 0.16, -0.26 + sin(t * 1.5) * 0.10), 0.23);
        field += blob(p, vec2(sin(t * 1.1) * 0.30, cos(t * 0.7) * 0.25), 0.16);
        field += blob(p, vec2(-0.12 + cos(t * 1.4) * 0.25, -0.42), 0.13);
        field += blob(p, mouse, 0.09);

        float liquid = smoothstep(0.92, 1.18, field);
        float rim = smoothstep(0.78, 1.02, field) - smoothstep(1.02, 1.28, field);
        float inner = smoothstep(1.15, 2.6, field);

        vec3 purple = vec3(0.36, 0.12, 0.84);
        vec3 violet = vec3(0.55, 0.26, 0.96);
        vec3 pink = vec3(0.88, 0.14, 0.52);
        vec3 color = mix(purple, pink, clamp(uv.x * 0.75 + uv.y * 0.25, 0.0, 1.0));
        color = mix(color, violet, inner * 0.55);
        color += rim * vec3(0.38, 0.18, 0.62);

        vec3 ironRed = vec3(0.86, 0.04, 0.025);
        vec3 ironGold = vec3(1.0, 0.58, 0.04);
        vec3 ironGlow = mix(ironRed, ironGold, clamp(uv.x + rim * 0.5, 0.0, 1.0));
        ironGlow += inner * vec3(0.05, 0.48, 0.62);
        color = mix(color, ironGlow, uIron);

        float edgeFade = smoothstep(0.0, 0.18, uv.y) * smoothstep(0.0, 0.12, 1.0 - uv.y);
        float alpha = (liquid * 0.18 + rim * 0.26 + inner * 0.08) * edgeFade;
        gl_FragColor = vec4(color, alpha);
      }
    `
  });

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    uniforms.uResolution.value.set(
      width * renderer.getPixelRatio(),
      height * renderer.getPixelRatio()
    );
  }

  function updatePointer(event) {
    pointerTarget.set(event.clientX / window.innerWidth, 1 - event.clientY / window.innerHeight);
  }

  let frame = 0;
  const clock = new THREE.Clock();

  function render() {
    pointer.lerp(pointerTarget, 0.035);
    uniforms.uTime.value = clock.getElapsedTime();
    renderer.render(scene, camera);
    if (!reduceMotion.matches && !document.hidden) frame = requestAnimationFrame(render);
  }

  function restart() {
    cancelAnimationFrame(frame);
    clock.start();
    render();
  }

  resize();
  restart();
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", updatePointer, { passive: true });
  window.addEventListener("iron-mode-change", (event) => {
    uniforms.uIron.value = event.detail?.enabled ? 1 : 0;
    render();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !reduceMotion.matches) restart();
  });
  reduceMotion.addEventListener("change", restart);
} catch (error) {
  console.warn("Fond liquide indisponible :", error);
  host.remove();
}
