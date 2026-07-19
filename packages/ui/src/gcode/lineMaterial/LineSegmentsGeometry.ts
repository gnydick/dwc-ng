/**
 * Forked from three@0.185.1's examples/jsm/lines/LineSegmentsGeometry.js.
 * Changes from upstream, for docs/superpowers/specs/
 * 2026-07-19-gcode-viewer-colorize-thick-lines-design.md:
 *   - setColors() now takes RGBA (stride 8, itemSize 4) instead of RGB
 *     (stride 6, itemSize 3) — stock Three.js has no per-vertex alpha
 *     channel on this geometry (see LineMaterial.ts's header comment).
 *   - Added setWidths() for a new per-segment width-scale instanced
 *     attribute, consumed by the forked LineMaterial.ts's vertex shader
 *     to give each segment real, independently-varying line width.
 * Everything else (bounding box/sphere computation, applyMatrix4, the
 * wireframe/mesh/lineSegments conversion helpers) is unchanged from
 * upstream.
 */
import {
	Box3,
	Float32BufferAttribute,
	InstancedBufferGeometry,
	InstancedInterleavedBuffer,
	InterleavedBufferAttribute,
	Sphere,
	Vector3,
} from "three";

const _box = new Box3();
const _vector = new Vector3();

export class LineSegmentsGeometry extends InstancedBufferGeometry {
	isLineSegmentsGeometry = true;

	constructor() {
		super();

		this.type = "LineSegmentsGeometry";

		const positions = [-1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0];
		const uvs = [-1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2];
		const index = [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5];

		this.setIndex(index);
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
	}

	applyMatrix4(matrix: any): this {
		const start = this.attributes.instanceStart;
		const end = this.attributes.instanceEnd;

		if (start !== undefined) {
			(start as any).applyMatrix4(matrix);
			(end as any).applyMatrix4(matrix);
			start.needsUpdate = true;
		}

		if (this.boundingBox !== null) this.computeBoundingBox();
		if (this.boundingSphere !== null) this.computeBoundingSphere();

		return this;
	}

	/** Length must be a multiple of six: each segment is (xyz xyz). */
	setPositions(array: Float32Array | number[]): this {
		const lineSegments = array instanceof Float32Array ? array : new Float32Array(array);
		const instanceBuffer = new InstancedInterleavedBuffer(lineSegments, 6, 1);

		this.setAttribute("instanceStart", new InterleavedBufferAttribute(instanceBuffer, 3, 0));
		this.setAttribute("instanceEnd", new InterleavedBufferAttribute(instanceBuffer, 3, 3));

		this.instanceCount = (this.attributes.instanceStart as InterleavedBufferAttribute).count;

		this.computeBoundingBox();
		this.computeBoundingSphere();

		return this;
	}

	/** Length must be a multiple of eight: each segment is (rgba rgba). */
	setColors(array: Float32Array | number[]): this {
		const colors = array instanceof Float32Array ? array : new Float32Array(array);
		const instanceColorBuffer = new InstancedInterleavedBuffer(colors, 8, 1);

		this.setAttribute("instanceColorStart", new InterleavedBufferAttribute(instanceColorBuffer, 4, 0));
		this.setAttribute("instanceColorEnd", new InterleavedBufferAttribute(instanceColorBuffer, 4, 4));

		return this;
	}

	/** One value per segment — the same scale applies to both of a
	 *  segment's vertices, unlike start/end colors/positions. */
	setWidths(array: Float32Array | number[]): this {
		const widths = array instanceof Float32Array ? array : new Float32Array(array);
		const instanceWidthBuffer = new InstancedInterleavedBuffer(widths, 1, 1);

		this.setAttribute("instanceWidthScale", new InterleavedBufferAttribute(instanceWidthBuffer, 1, 0));

		return this;
	}

	computeBoundingBox(): void {
		if (this.boundingBox === null) this.boundingBox = new Box3();

		const start = this.attributes.instanceStart;
		const end = this.attributes.instanceEnd;

		if (start !== undefined && end !== undefined) {
			this.boundingBox.setFromBufferAttribute(start as any);
			_box.setFromBufferAttribute(end as any);
			this.boundingBox.union(_box);
		}
	}

	computeBoundingSphere(): void {
		if (this.boundingSphere === null) this.boundingSphere = new Sphere();
		if (this.boundingBox === null) this.computeBoundingBox();

		const start = this.attributes.instanceStart;
		const end = this.attributes.instanceEnd;

		if (start !== undefined && end !== undefined) {
			const center = this.boundingSphere.center;
			this.boundingBox!.getCenter(center);

			let maxRadiusSq = 0;
			for (let i = 0, il = start.count; i < il; i++) {
				_vector.fromBufferAttribute(start as any, i);
				maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
				_vector.fromBufferAttribute(end as any, i);
				maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
			}

			this.boundingSphere.radius = Math.sqrt(maxRadiusSq);
		}
	}
}
