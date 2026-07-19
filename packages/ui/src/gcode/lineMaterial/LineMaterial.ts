/**
 * Forked from three@0.185.1's examples/jsm/lines/LineMaterial.js.
 * Changes from upstream, for docs/superpowers/specs/
 * 2026-07-19-gcode-viewer-colorize-thick-lines-design.md:
 *   - instanceColorStart/instanceColorEnd are vec4 (RGBA) instead of vec3
 *     (RGB) — stock LineMaterial has no per-vertex alpha (a real,
 *     unresolved upstream limitation: github.com/mrdoob/three.js/issues/23680,
 *     "Add vertex color alpha channel support to LineMaterial"). A
 *     dedicated `vLineColor` varying replaces the stock chunks
 *     (`color_pars_vertex`/`color_pars_fragment`/`color_fragment`), which
 *     hardcode vec3 and can't be reused for vec4 without their own fork.
 *   - Added a per-segment `instanceWidthScale` attribute, multiplied into
 *     the world-units half-width calculation, so each segment can have
 *     genuinely different width (stock LineMaterial.linewidth is one
 *     scalar for the whole material).
 *   - Dash support, screen-space (non-worldUnits) width, and
 *     alpha-to-coverage are left in place unchanged — this app always
 *     constructs the material with worldUnits:true, but the fork doesn't
 *     remove the other modes.
 *   - Trimmed upstream's per-property JSDoc blocks (this project's own
 *     convention favors terse comments over verbose per-getter docs);
 *     the runtime behavior of every getter/setter is unchanged from
 *     upstream.
 *   - TS-only deviation (no runtime behavior change): `type: "LineMaterial"`
 *     is set via a statement after super() instead of inside the super()
 *     call's object literal, because @types/three's ShaderMaterialParameters
 *     doesn't include `type` as a settable property (upstream's untyped
 *     .js has no such constraint).
 */
import { ShaderLib, ShaderMaterial, UniformsLib, UniformsUtils, Vector2 } from "three";

(UniformsLib as any).line = {
	worldUnits: { value: 1 },
	linewidth: { value: 1 },
	resolution: { value: new Vector2() },
	dashOffset: { value: 0 },
	dashScale: { value: 1 },
	dashSize: { value: 1 },
	gapSize: { value: 1 },
};

(ShaderLib as any).line = {
	uniforms: UniformsUtils.merge([
		(UniformsLib as any).common,
		(UniformsLib as any).fog,
		(UniformsLib as any).line,
	]),

	vertexShader: /* glsl */ `
		#include <common>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec4 instanceColorStart;
		attribute vec4 instanceColorEnd;
		varying vec4 vLineColor;

		attribute float instanceWidthScale;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH
				varying vec2 vUv;
			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH
			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;
		#endif

		float trimSegmentAlpha( const in vec4 start, const in vec4 end ) {
			float a = projectionMatrix[ 2 ][ 2 ];
			float b = projectionMatrix[ 3 ][ 2 ];
			float nearEstimate = ( a > 0.0 ) ? ( - b / ( a + 1.0 ) ) : ( - 0.5 * b / a );
			return ( nearEstimate - start.z ) / ( end.z - start.z );
		}

		void main() {

			vLineColor = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			float aspect = resolution.x / resolution.y;

			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef USE_DASH
				float lineDistanceStart = dashScale * instanceDistanceStart;
				float lineDistanceEnd = dashScale * instanceDistanceEnd;
			#endif

			#ifdef WORLD_UNITS
				worldStart = start.xyz;
				worldEnd = end.xyz;
			#else
				vUv = uv;
			#endif

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 );

			if ( perspective ) {
				if ( start.z < 0.0 && end.z >= 0.0 ) {
					float alpha = trimSegmentAlpha( start, end );
					end.xyz = mix( start.xyz, end.xyz, alpha );
					#ifdef USE_DASH
						lineDistanceEnd = mix( lineDistanceStart, lineDistanceEnd, alpha );
					#endif
				} else if ( end.z < 0.0 && start.z >= 0.0 ) {
					float alpha = trimSegmentAlpha( end, start );
					start.xyz = mix( end.xyz, start.xyz, alpha );
					#ifdef USE_DASH
						lineDistanceStart = mix( lineDistanceEnd, lineDistanceStart, alpha );
					#endif
				}
			}

			#ifdef USE_DASH
				vLineDistance = ( position.y < 0.5 ) ? lineDistanceStart : lineDistanceEnd;
				vUv = uv;
			#endif

			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			vec2 dir = ndcEnd.xy - ndcStart.xy;

			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				float hw = linewidth * 0.5 * instanceWidthScale;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				#ifndef USE_DASH
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;
					worldPos.xyz += worldFwd * hw;
					if ( position.y > 1.0 || position.y < 0.0 ) {
						worldPos.xyz -= worldFwd * 2.0 * hw;
					}
				#endif

				vec4 clip = projectionMatrix * worldPos;

				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				dir.x /= aspect;
				offset.x /= aspect;

				if ( position.x < 0.0 ) offset *= - 1.0;

				if ( position.y < 0.0 ) {
					offset += - dir;
				} else if ( position.y > 1.0 ) {
					offset += dir;
				}

				offset *= linewidth * instanceWidthScale;
				offset /= resolution.y;

				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end;

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,

	fragmentShader: /* glsl */ `
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH
			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;
		#endif

		varying float vLineDistance;
		varying vec4 vLineColor;

		#ifdef WORLD_UNITS
			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;
			#ifdef USE_DASH
				varying vec2 vUv;
			#endif
		#else
			varying vec2 vUv;
		#endif

		#include <common>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {
			float mua; float mub;
			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;
			vec3 p21 = p2 - p1;
			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );
			float denom = d2121 * d4343 - d4321 * d4321;
			float numer = d1343 * d4321 - d1321 * d4343;
			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );
			return vec2( mua, mub );
		}

		void main() {

			float alpha = opacity;
			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <clipping_planes_fragment>

			#ifdef USE_DASH
				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard;
				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard;
			#endif

			#ifdef WORLD_UNITS

				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );
				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH
					#ifdef USE_ALPHA_TO_COVERAGE
						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );
					#else
						if ( norm > 0.5 ) discard;
					#endif
				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );
					if ( abs( vUv.y ) > 1.0 ) {
						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );
					}
				#else
					if ( abs( vUv.y ) > 1.0 ) {
						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;
						if ( len2 > 1.0 ) discard;
					}
				#endif

			#endif

			diffuseColor.rgb *= vLineColor.rgb;

			#include <logdepthbuf_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha * vLineColor.a );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`,
};

export class LineMaterial extends ShaderMaterial {
	isLineMaterial = true;

	constructor(parameters?: Record<string, unknown>) {
		super({
			// `type` is set as a statement below, not here: @types/three's
			// ShaderMaterialParameters (unlike the untyped upstream .js) does
			// not include `type` among the settable constructor properties,
			// so passing it inline fails typecheck (TS2353) even though
			// upstream's LineMaterial.js does exactly this.
			uniforms: UniformsUtils.clone((ShaderLib as any).line.uniforms),
			vertexShader: (ShaderLib as any).line.vertexShader,
			fragmentShader: (ShaderLib as any).line.fragmentShader,
			clipping: true,
		});
		this.type = "LineMaterial";

		this.setValues(parameters as any);
	}

	get color() { return (this.uniforms as any).diffuse.value; }
	set color(value) { (this.uniforms as any).diffuse.value = value; }

	get worldUnits() { return "WORLD_UNITS" in this.defines!; }
	set worldUnits(value: boolean) {
		if ((value === true) !== this.worldUnits) this.needsUpdate = true;
		if (value === true) this.defines!.WORLD_UNITS = "";
		else delete this.defines!.WORLD_UNITS;
	}

	get linewidth() { return (this.uniforms as any).linewidth.value; }
	set linewidth(value: number) {
		if (!(this.uniforms as any).linewidth) return;
		(this.uniforms as any).linewidth.value = value;
	}

	get dashed() { return "USE_DASH" in this.defines!; }
	set dashed(value: boolean) {
		if ((value === true) !== this.dashed) this.needsUpdate = true;
		if (value === true) this.defines!.USE_DASH = "";
		else delete this.defines!.USE_DASH;
	}

	get dashScale() { return (this.uniforms as any).dashScale.value; }
	set dashScale(value: number) { (this.uniforms as any).dashScale.value = value; }

	get dashSize() { return (this.uniforms as any).dashSize.value; }
	set dashSize(value: number) { (this.uniforms as any).dashSize.value = value; }

	get dashOffset() { return (this.uniforms as any).dashOffset.value; }
	set dashOffset(value: number) { (this.uniforms as any).dashOffset.value = value; }

	get gapSize() { return (this.uniforms as any).gapSize.value; }
	set gapSize(value: number) { (this.uniforms as any).gapSize.value = value; }

	get opacity() { return (this.uniforms as any).opacity.value; }
	set opacity(value: number) {
		if (!this.uniforms) return;
		(this.uniforms as any).opacity.value = value;
	}

	get resolution() { return (this.uniforms as any).resolution.value; }
	set resolution(value: { x: number; y: number }) { (this.uniforms as any).resolution.value.copy(value); }

	get alphaToCoverage() { return "USE_ALPHA_TO_COVERAGE" in this.defines!; }
	set alphaToCoverage(value: boolean) {
		if (!this.defines) return;
		if ((value === true) !== this.alphaToCoverage) this.needsUpdate = true;
		if (value === true) this.defines.USE_ALPHA_TO_COVERAGE = "";
		else delete this.defines.USE_ALPHA_TO_COVERAGE;
	}
}
