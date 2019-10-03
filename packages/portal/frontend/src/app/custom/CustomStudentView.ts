import {ManualMarkingView} from "./ManualMarkingView";

export class CustomStudentView extends ManualMarkingView {

    constructor(remoteUrl: string, customLoggingName: string = `ManualMarkingView`) {
        super(remoteUrl, customLoggingName);
    }


}
