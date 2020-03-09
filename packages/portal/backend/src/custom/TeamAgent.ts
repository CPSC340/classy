import Log from "../../../../common/Log";
import {ClasslistChangesTransport} from "../../../../common/types/PortalTypes";
import {DatabaseController} from "../controllers/DatabaseController";
import {DeliverablesController} from "../controllers/DeliverablesController";
import {GitHubActions} from "../controllers/GitHubActions";
import {GitHubController} from "../controllers/GitHubController";
import {PersonController} from "../controllers/PersonController";
import {TeamController} from "../controllers/TeamController";
import {Factory} from "../Factory";
import {CSVParser} from "../server/common/CSVParser";
import {AuditLabel, Deliverable, Person, Team} from "../Types";

export class TeamAgent {

    constructor() {
        //
    }

    private tc = new TeamController();
    private db = DatabaseController.getInstance();
    private dc = new DeliverablesController();
    private pc = new PersonController();

    public async processTeamList(initiatorPersonId: string = null, path: string = null,  data: any):
        Promise<{successCount: number, failCount: number}> {
        Log.trace("TeamAgent::processTeamList(...) - start");

        const cc = await Factory.getCourseController(new GitHubController(GitHubActions.getInstance()));

        let successCount: number = 0;
        let failCount: number = 0;

        if (path !== null) {
            data = await new CSVParser().parsePath(path);
        }

        this.missingDataCheck(data, ['DELIVID']);

        for (const row of data) {
            // verify that the row has the "delivId" data column
            if (typeof row.DELIVID !== 'undefined') {
                const delivId = row.DELIVID;
                const rowData: string[] =  row.entries();
                rowData.shift();
                const personIds: string[] = rowData;

                const deliverable: Deliverable = await this.dc.getDeliverable(delivId);
                const personsPromises: Array<Promise<Person | null>> = [];
                for (const personId of personIds) {
                    personsPromises.push(this.pc.getPerson(personId));
                }
                const persons: Array<Person | null> = await Promise.all(personsPromises) as Array<Person | null>;
                // const persons: Array<Person | null> = await Promise.all(personIds.map((personId) => this.pc.getPerson(personId)));

                // check if any of the persons isn't actually in the database
                if (!persons.includes(null)) {
                    Log.warn(`TeamAgent::processTeamList(..) - Found issue with row: ${JSON.stringify(row)}, ` +
                        `person ID did not resolve to a valid database entry`);
                    failCount += 1;
                    continue;
                }

                // check all persons forming the team don't already have a team for this deliverable
                let cont: boolean = true;
                for (const person of persons) {
                    const teams = await this.tc.getTeamsForPerson(person);
                    for (const aTeam of teams) {
                        // if you previously encountered an error, don't continue checking
                        if (cont === false) {
                            break;
                        }
                        if (aTeam.delivId === delivId) {
                            Log.warn(`TeamAgent::processTeamList(..) - Student: ${person.id} ` +
                                `already has a team for deliverable: ${delivId}`);
                            failCount += 1;
                            cont = false;
                        }
                    }

                    // if there was an error, don't keep checking other persons
                    if (cont === false) {
                        break;
                    }
                }

                // if there was an error, don't continue with setting up a team
                if (cont === false) {
                    continue;
                }
                // attempt to compute the name
                const names = await cc.computeNames(deliverable, persons);

                let team = await this.tc.getTeam(names.teamName);
                if (team === null) {
                    // if the CourseController did not form the team, form it
                    team = await this.tc.formTeam(names.teamName, deliverable, persons, true);
                }

                successCount += 1;
            } else {
                Log.warn(`TeamAgent::processTeamList(..) - DELIVID column missing from ${JSON.stringify(row)}`);
                failCount += 1;
            }

            await this.db.writeAudit(`Teamlist Upload` as AuditLabel, initiatorPersonId, {}, {},
                {successCount: successCount, failCount: failCount});
            return {successCount: successCount, failCount: failCount};
        }
    }

    private duplicateDataCheck(data: any[], columnNames: string[]) {
        Log.trace('TeamAgent::duplicateDataCheck -- start');
        const that = this;
        const dupColumnData: any = {};
        columnNames.forEach(function(column) {
            Object.assign(dupColumnData, {[column]: that.getDuplicateRowsByColumn(data, column)});
        });
        columnNames.forEach(function(column) {
            if (dupColumnData[column].length) {
                Log.error('TeamAgent::duplicateDataCheck(..) - ERROR: Duplicate Data Check Error'
                    + JSON.stringify(dupColumnData));
                throw new Error('Duplicate Data Check Error: ' + JSON.stringify(dupColumnData));
            }
        });
    }

    private getDuplicateRowsByColumn(data: any[], column: string): any[] {
        Log.trace('TeamAgent::getDuplicateRowsByColumn -- start');
        const set = new Set();
        return data.filter((row) => {
            if (set.has(row[column].toLowerCase())) {
                return true;
            }
            set.add(row[column].toLowerCase());
            return false;
        });
    }

    private getMissingDataRowsByColumn(data: any[], column: string): any[] {
        Log.trace('TeamAgent::getMissingDataRowsByColumn -- start');
        return data.filter((row) => {
            if (row[column] === '' || typeof row[column] === 'undefined') {
                return true;
            }
            return false;
        });
    }

    private missingDataCheck(data: any[], columns: string[]) {
        Log.trace('TeamAgent::missingDataCheck -- start');
        const that = this;
        const missingData: any = {};
        columns.forEach((column) => {
            Object.assign(missingData, {[column]: that.getMissingDataRowsByColumn(data, column)});
        });
        columns.forEach((column) => {
            if (missingData[column].length) {
                Log.error('TeamAgent::missingDataCheck(..) - ERROR: Certain fields cannot be empty: '
                    + JSON.stringify(missingData));
                throw new Error('Certain fields cannot be empty: ' + JSON.stringify(missingData));
            }
        });
    }
}
