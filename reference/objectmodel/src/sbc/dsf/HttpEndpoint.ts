import ModelObject from "../../ModelObject";

export enum HttpEndpointType {
    GET = "GET",
    POST = "POST",
    PUT = "PUT",
    PATCH = "PATCH",
    TRACE = "TRACE",
    DELETE = "DELETE",
    OPTIONS = "OPTIONS",
    WebSocket = "WebSocket"
}

export class HttpEndpoint extends ModelObject {
    endpointType: HttpEndpointType = HttpEndpointType.GET;
    namespace: string = "";
    path: string = "";
    isUploadRequest: boolean = false;
    unixSocket: string = "";
}

export default HttpEndpoint;
