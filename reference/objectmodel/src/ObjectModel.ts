import ModelCollection from "./ModelCollection";
import ModelDictionary from "./ModelDictionary";
import ModelObject from "./ModelObject";

import Board from "./boards";
import Directories from "./directories";
import Fan from "./fans";
import Heat from "./heat";
import InputChannel from "./inputs/InputChannel";
import Job from "./job";
import Limits from "./limits";
import Message from "./messages";
import Move from "./move";
import Network from "./network";
import Plugin from "./plugins";
import SBC from "./sbc";
import Sensors from "./sensors";
import Spindle from "./spindles";
import State from "./state";
import Tool from "./tools";
import Volume from "./volumes";
import LedStrip from "./ledStrips";

/**
 * Refer to the DSF/RRF documentation for descriptions of the object model fields
 */
export class ObjectModel extends ModelObject {
    constructor() {
        super();
		ModelObject.wrapModelProperty(this, "sbc", SBC);
    }

	readonly boards: ModelCollection<Board> = new ModelCollection(Board);
	readonly directories: Directories = new Directories();
	readonly fans: ModelCollection<Fan | null> = new ModelCollection(Fan);
	readonly global: ModelDictionary<any> = new ModelDictionary(false);
	readonly heat: Heat = new Heat();
	readonly inputs: ModelCollection<InputChannel | null> = new ModelCollection(InputChannel);
	readonly job: Job = new Job();
	readonly ledStrips: ModelCollection<LedStrip> = new ModelCollection(LedStrip);
	readonly limits: Limits = new Limits();
	readonly messages: ModelCollection<Message> = new ModelCollection(Message);         // must be manually cleared after updates
	readonly move: Move = new Move();
	readonly network: Network = new Network();
	readonly plugins: ModelDictionary<Plugin> = new ModelDictionary(true, Plugin);
	sbc: SBC | null = null;
	readonly sensors: Sensors = new Sensors();
	readonly spindles: ModelCollection<Spindle | null> = new ModelCollection(Spindle);
	readonly state: State = new State();
	readonly tools: ModelCollection<Tool | null> = new ModelCollection(Tool);
	readonly volumes: ModelCollection<Volume> = new ModelCollection(Volume);
}

export default ObjectModel;
