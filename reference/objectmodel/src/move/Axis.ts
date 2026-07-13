import ModelObject from "../ModelObject";
import ModelCollection from "../ModelCollection";
import DriverId from "./DriverId";
import Microstepping from "./Microstepping";

export enum AxisLetter {
    X = 'X',
    Y = 'Y',
    Z = 'Z',
    U = 'U',
    V = 'V',
    W = 'W',
    A = 'A',
    B = 'B',
    C = 'C',
    D = 'D',
    a = 'a',
    b = 'b',
    c = 'c',
    d = 'd',
    e = 'e',
    f = 'f',
    g = 'g',
    h = 'h',
    i = 'i',
    j = 'j',
    k = 'k',
    l = 'l',
    m = 'm',
    n = 'n',
    o = 'o',
    p = 'p',
    q = 'q',
    r = 'r',
    s = 's',
    t = 't',
    u = 'u',
    v = 'v',
    w = 'w',
    x = 'x',
    y = 'y',
    z = 'z',
    none = ''
}

export class Axis extends ModelObject {
    acceleration: number = 0;
    babystep: number = 0;
    backlash: number = 0;
    current: number = 0;
    readonly drivers: ModelCollection<DriverId> = new ModelCollection(DriverId);
    homed: boolean = false;
    jerk: number = 15;
    letter: AxisLetter = AxisLetter.none;
    machinePosition: number | null = null;
    max: number = 200;
    maxProbed: boolean = false;
    readonly microstepping: Microstepping = new Microstepping();
    min: number = 0;
    minProbed: boolean = false;
    percentCurrent: number = 100;
    percentStstCurrent: number | null = null;
    phaseStep: boolean | null = null;
    printingJerk: number = 15;
    reducedAcceleration: number = 0;
    speed: number = 100;
    stepsPerMm: number = 80;
    stepPos: number = 0;
    userPosition: number | null = null;
    visible: boolean = true;
    workplaceOffsets: Array<number> = new Array<number>();
}

export default Axis
