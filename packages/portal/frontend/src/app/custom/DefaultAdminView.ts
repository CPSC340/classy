import Log from "../../../../../common/Log";
import {AdminTabs, AdminView} from "../views/AdminView";

/**
 * Stock Default Admin view
 */
export class DefaultAdminView extends AdminView {
    constructor(remoteUrl: string, tabs: AdminTabs) {
        Log.info("DefaultAdminView::<init>(..)");
        super(remoteUrl, tabs);
    }

    public renderPage(name: string, opts: any) {
        Log.info('DefaultAdminView::renderPage( ' + name + ', ... ) - start; options: ' + JSON.stringify(opts));
        super.renderPage(name, opts);
    }
}
