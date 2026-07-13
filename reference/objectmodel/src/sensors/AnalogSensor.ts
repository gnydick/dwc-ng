import ModelObject from "../ModelObject";

export enum AnalogSensorType {
    thermistor = "thermistor",
    pt1000 = "pt1000",
    max31865 = "rtdmax31865",
    max31855 = "thermocouplemax31855",
    max31856 = "thermocouplemax31856",
    linearAnalog = "linearanalog",
    dht21 = "dht21",
    dht22 = "dht22",
    dhtHumidity = "dhthumidity",
	bme280 = "bme280",
	bme280pressure = "bmepressure",
	bme280humidity = "bmehumidity",
	currentLoop = "currentloooppyro",
	ads131chan0 = "ads131.chan0",
	ads131chan1 = "ads131.chan1",
    mcuTemp = "mcutemp",
    drivers = "drivers",
    driversDuex = "driversduex",
    unknown = "unknown"
}

export enum TemperatureError {
	ok = "ok",
	shortCircuit = "shortCircuit",
	shortToVcc = "shortToVcc",
	shortToGround = "shortToGround",
	openCircuit = "openCircuit",
	timeout = "timeout",
	ioError = "ioError",
	hardwareError = "hardwareError",
	notReady = "notReady",
	invalidOutputNumber = "invalidOutputNumber",
	busBusy = "busBusy",
	badResponse = "badResponse",
	unknownPort = "unknownPort",
	notInitialised = "notInitialised",
	unknownSensor = "unknownSensor",
	overOrUnderVoltage = "overOrUnderVoltage",
	badVref = "badVref",
	badVssa = "badVssa",
	unknownError = "unknownError"
}

export class AnalogSensor extends ModelObject {
	beta: number | null = null;
	c: number | null = null;
	highReading: number | null = null;
	lastReading: number | null = null;
	lowReading: number | null = null;
	name: string | null = null;
	offsetAdj: number = 0;
    port: string | null = null;
	r25: number | null = null;
	rRef: number | null = null;
	slopeAdj: number = 0;
    state: TemperatureError = TemperatureError.ok;
    type: AnalogSensorType = AnalogSensorType.unknown;
}

export default AnalogSensor
