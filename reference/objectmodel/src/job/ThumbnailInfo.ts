import { ModelObject } from "../ModelObject";

export enum ThumbnailFormat {
    jpeg = 'jpeg',
    png = 'png',
    qoi = 'qoi'
}

export class ThumbnailInfo extends ModelObject {
    data: string | null = null;
    format: ThumbnailFormat = ThumbnailFormat.png;
    height: number = 0;
    offset: number = 0;
    size: number = 0;
    width: number = 0;
}

export default ThumbnailInfo
