import { useEffect, useRef } from "react";

// A low-resolution, continuous cloud field over the original landscape.
// No video download; no animation loop while paused or in a hidden tab.
export default function CelestialAtmosphere({ paused }: { paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });
    if (!el || !gl) return;
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(
      vertex,
      "attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}",
    );
    gl.compileShader(vertex);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(
      fragment,
      `precision mediump float;
      uniform vec2 resolution;
      uniform float time;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
      float cloud(vec2 p){float f=0.,a=.5;for(int i=0;i<4;i++){f+=noise(p)*a;p=mat2(.8,-.6,.6,.8)*p*2.03;a*=.5;}return f;}
      void main(){
        vec2 uv=gl_FragCoord.xy/resolution;
        vec2 p=vec2(uv.x*resolution.x/resolution.y,uv.y);
        float t=time*.032;
        float drift=cloud(p*2.5+vec2(t,-t*.13));
        float mist=cloud(p*vec2(3.7,7.)+vec2(t*.8,drift*.8));
        float horizon=exp(-pow((uv.y-.30)*5.4,2.));
        float opening=smoothstep(.08,.72,uv.x);
        float density=smoothstep(.34,.8,mist)*horizon*(.19+.35*opening);
        float upper=cloud(p*vec2(2.,3.)+vec2(-t*.33,t*.12));
        density+=smoothstep(.56,.86,upper)*smoothstep(.4,.9,uv.y)*.085;
        vec3 color=mix(vec3(.36,.46,.50),vec3(.64,.59,.46),smoothstep(.1,.45,uv.y)*opening*.5);
        gl_FragColor=vec4(color,density);
      }`,
    );
    gl.compileShader(fragment);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteProgram(program);
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const size = gl.getUniformLocation(program, "resolution"),
      clock = gl.getUniformLocation(program, "time");
    let frame = 0,
      elapsed = 6,
      previous = 0;
    const draw = () => {
      gl.uniform1f(clock, elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    const resize = () => {
      const scale = innerWidth < 700 ? 0.55 : 0.7;
      el.width = Math.round(innerWidth * scale);
      el.height = Math.round(innerHeight * scale);
      gl.viewport(0, 0, el.width, el.height);
      gl.uniform2f(size, el.width, el.height);
      draw();
    };
    const loop = (now: number) => {
      if (now - previous >= 40) {
        elapsed += Math.min((now - (previous || now)) / 1000, 0.1);
        previous = now;
        draw();
      }
      frame = requestAnimationFrame(loop);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (!document.hidden && !paused) frame = requestAnimationFrame(loop);
    };
    resize();
    visibility();
    addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [paused]);
  return (
    <canvas ref={canvas} className="celestial-atmosphere" aria-hidden="true" />
  );
}
