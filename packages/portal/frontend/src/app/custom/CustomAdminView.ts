import Log from "../../../../../common/Log";
import {AdminTabs} from "../views/AdminView";
import {ManualMarkingAdminView} from "./ManualMarkingAdminView";

export class CustomAdminView extends ManualMarkingAdminView {
    constructor(remoteUrl: string, tabs: AdminTabs, customLoggingName: string = "ManualMarkingAdminView") {
        Log.error(`${customLoggingName}::constructor - init`);
        super(remoteUrl, tabs, customLoggingName);
    }
}
