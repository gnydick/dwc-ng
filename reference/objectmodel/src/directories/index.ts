import ModelObject from "../ModelObject";

export class Directories extends ModelObject {
    filaments: string = "0:/filaments/";
    firmware: string = "0:/firmware/";
    gCodes: string = "0:/gcodes/";
    macros: string = "0:/macros/";
    menu: string = "0:/menu/";
    system: string = "0:/sys/";
    web: string = "0:/www/";
}

export default Directories
