"use client"

import { useEffect, useRef } from "react"

const VERTEX_SHADER = `#version 300 es
in vec4 a_position;
void main() {
  gl_Position = a_position;
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
out vec4 fragColor;

// 8x8 Bayer matrix (normalized to 0-1)
float bayer8(vec2 p) {
  ivec2 i = ivec2(mod(p, 8.0));
  int index = i.x + i.y * 8;

  // Bayer 8x8 ordered dither threshold
  int b[64] = int[64](
     0, 48, 12, 60,  3, 51, 15, 63,
    32, 16, 44, 28, 35, 19, 47, 31,
     8, 56,  4, 52, 11, 59,  7, 55,
    40, 24, 36, 20, 43, 27, 39, 23,
     2, 50, 14, 62,  1, 49, 13, 61,
    34, 18, 46, 30, 33, 17, 45, 29,
    10, 58,  6, 54,  9, 57,  5, 53,
    42, 26, 38, 22, 41, 25, 37, 21
  );

  return float(b[index]) / 64.0;
}

// Simplex-like value noise for the gradient
vec3 permute3(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
    dot(x12.zw,x12.zw)), 0.0);
  m = m*m;
  m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * 0.03;

  // Slow-moving gradient via noise
  float n = snoise(uv * 2.0 + t) * 0.5 + 0.5;

  // Second, slower field carves drifting pockets where dots turn mint
  float glow = snoise(uv * 1.3 - t * 0.6 + 7.0) * 0.5 + 0.5;
  glow = smoothstep(0.5, 0.95, glow);

  // Dither the gradient with Bayer matrix — scale up for visible dots
  float threshold = bayer8(floor(gl_FragCoord.xy / 3.0));
  float dithered = step(threshold, n * 0.7);

  // Charcoal dots shifting toward brand mint (#b2fab4) inside the pockets
  vec3 mint = vec3(0.698, 0.980, 0.706);
  vec3 greyDot = vec3(0.16);
  vec3 dotColor = mix(greyDot, mint * 0.5, glow);
  vec3 color = vec3(0.015) + dithered * dotColor;

  // Winking sparkles, like the chart stars: rare cells of the same dither
  // grid glint mint, each on its own phase
  vec2 cell = floor(gl_FragCoord.xy / 3.0);
  float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  float wink = (sin(u_time * 1.5 + h * 6283.185) + 1.0) * 0.5;
  color += mint * step(0.9998, h) * wink * wink * 0.8;

  fragColor = vec4(color, 1.0);
}
`

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("DitherBackground shader:", gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(
  gl: WebGL2RenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
): WebGLProgram | null {
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

export function DitherBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext("webgl2")
    if (!gl) return

    const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    if (!vs || !fs) return

    const program = createProgram(gl, vs, fs)
    if (!program) return

    const positionLoc = gl.getAttribLocation(program, "a_position")
    const timeLoc = gl.getUniformLocation(program, "u_time")
    const resolutionLoc = gl.getUniformLocation(program, "u_resolution")

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.enableVertexAttribArray(positionLoc)
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2)
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      gl.viewport(0, 0, canvas.width, canvas.height)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const activateProgram = gl.useProgram.bind(gl)
    activateProgram(program)

    let frame: number
    const start = performance.now()

    const render = () => {
      const time = (performance.now() - start) / 1000
      gl.uniform1f(timeLoc, time)
      gl.uniform2f(resolutionLoc, canvas.width, canvas.height)
      gl.bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      frame = requestAnimationFrame(render)
    }

    frame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buffer)
      gl.deleteVertexArray(vao)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
      tabIndex={-1}
      aria-hidden
    />
  )
}
