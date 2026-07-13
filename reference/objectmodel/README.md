# ObjectModel

TypeScript implementation of the Duet3D Object Model.

## Installation

Install via `npm install @duet3d/objectmodel`. Users of Vue 2 must also run this command after the first import:

```
globalThis._duetModelSetArray = (array, index, value) => Vue.set(array, index, value);
```

This is required to make sure that change events for arrays are correctly fired.

## Bug reports

Please use the [forum](https://forum.duet3d.com) for support requests or the [DuetWebControl](https://github.com/Duet3D/DuetWebControl) GitHub repository for feature requests and bug reports.
