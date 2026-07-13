import ObjectModel, { initObject, Plugin } from "../src";
import { fullModel } from "./update";

test("clone", () => {
    const model = new ObjectModel();
    model.update(fullModel);
    model.plugins.set("Test", initObject(Plugin, { id: "Test", name: "Test Plugin" }));

    const serializedFullModel = JSON.stringify(model);
    const secondModel = new ObjectModel();
    secondModel.update(JSON.parse(serializedFullModel));
    expect(JSON.stringify(secondModel)).toBe(serializedFullModel);

    expect(secondModel.plugins.size).toBe(1);
    expect(secondModel.plugins.get("Test")).toBeInstanceOf(Plugin);
    expect(secondModel.plugins.get("Test")?.name).toBe("Test Plugin");
});
