import ModelObject from "../ModelObject";

export enum MessageType {
    success,
    warning ,
    error
}

export class Message extends ModelObject {
    content: string = "";
    time: Date = new Date();
    type: MessageType = MessageType.success;

    toString(): string {
        switch (this.type) {
            case MessageType.success: return this.content;
            case MessageType.warning: return "Warning: " + this.content;
            case MessageType.error: return "Error: " + this.content;
        }
    }
}

export default Message
