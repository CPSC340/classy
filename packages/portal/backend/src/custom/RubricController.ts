import * as fs from "fs";
import * as path from 'path';
import Log from "../../../../common/Log";
import {
    AssignmentInfo,
    AssignmentRubric,
    QuestionRubric,
    SubQuestionRubric
} from "../../../../common/types/CS340Types";
import {DatabaseController} from "../controllers/DatabaseController";
import {GitHubActions, IGitHubActions} from "../controllers/GitHubActions";
import {Deliverable} from "../Types";

// tslint:disable-next-line
const tmp = require('tmp-promise');

export class RubricController {
    private db: DatabaseController = DatabaseController.getInstance();
    private gha: IGitHubActions = GitHubActions.getInstance();

    public async updateRubric(delivId: string): Promise<boolean> {
        Log.info(`RubricController::updateRubric(${delivId})`);
        // Log.info("RubricController::updateRubric(..) - ");
        // Log.error(`RubricController::updateRubric(..) -`);

        const deliverableRecord: Deliverable = await this.db.getDeliverable(delivId);
        if (deliverableRecord === null) {
            Log.error(`RubricController::updateRubric(..) - Error: Unable to find deliverable with id: ${delivId}`);
            return false;
        }

        if (deliverableRecord.custom.assignment === undefined || deliverableRecord.custom.assignment === null ||
            typeof (deliverableRecord.custom.assignment as AssignmentInfo).status === 'undefined') {
            Log.error(`RubricController::updateRubric(..) - Error: Deliverable with id: ${delivId} is not an assignment`);
            return true;
        }

        const assignInfo: AssignmentInfo = deliverableRecord.custom.assignment;
        if (assignInfo.mainFilePath.trim() === "") {
            Log.info(`RubricController::updateRubric(..) - No specified main file; skipping rubric generation`);
            return true;
        }

        const tempDir = await tmp.dir({dir: '/tmp', unsafeCleanup: true});
        const tempPath = tempDir.path;

        Log.info("RubricController::updateRubric(..) - cloning");
        await this.cloneRepo(deliverableRecord.importURL, tempPath); // clones the repository to the directory
        Log.info("RubricController::updateRubric(..) - clone complete; reading file");

        let exists: boolean = false;
        try {
            exists = fs.existsSync(path.join(tempPath, assignInfo.mainFilePath));
            if (exists) {
                return (new Promise(((resolve, reject) => {
                    fs.readFile(path.join(tempPath, assignInfo.mainFilePath), async (err, data) => {
                        if (err) {
                            Log.error(`RubricController::updateRubric(..)::readFile - error reading file;` +
                                ` err: ${JSON.stringify(err)}`);
                            reject(false);
                        }

                        const arrayData: string[] = data.toString().split('\n');

                        const newQuestions: QuestionRubric[] = [];
                        for (let i = 0 ; i < arrayData.length; i++) {
                            const regexp: RegExp = /rub(r(ic)?)? *[=:]? *({.*})/;
                            if (regexp.test(arrayData[i])) {
                                Log.info("RubricController::updateRubric(..) - rubric found: " + arrayData[i]);
                                // depends on what kind of file
                                // check for LaTeX
                                const latexFileExp: RegExp = /[^.]*\.tex/;
                                let headerString: string;
                                let headerExp: RegExp;
                                let headerCleaner: RegExp;
                                if (latexFileExp.test(assignInfo.mainFilePath)) {
                                    // if this is a latex file, use a different exp
                                    headerExp = /(?:sub?:)*section(?:\*?:)?.*/;
                                    headerCleaner = /([{}\n]|\\(sub)?section|(["'])?,$|^\s*(["']))/g;
                                } else {
                                    headerExp = /#\s+.*/;
                                    headerCleaner = /((#+\s+)|\\n|(["'])?,$|^\s*(["']))/g;
                                }
                                const rubricString = arrayData[i];
                                headerString = this.reverseBack(arrayData, i, headerExp);
                                Log.info("RubricController::updateRubric(..) - header found: " + headerString);

                                // clean up the header;
                                let cleanedHeader: string;
                                cleanedHeader = headerString.replace(headerCleaner, "");

                                Log.info("RubricController::updateRubric(..) - cleaned header: " +
                                    cleanedHeader);

                                // Check if the header contains the words "bonus" or "optional"
                                // if they do, do not add these weights to the grade total
                                const bonusHeaderExpr = /(bonus|optional)/ig;
                                let bonusQuestion = false;
                                if (cleanedHeader.match(bonusHeaderExpr)) {
                                    bonusQuestion = true;
                                }

                                // clean the data
                                // get only the inside of the rubric
                                const rubricArray: string[] = rubricString.match(/{.*}/);
                                const subQuestionArray: SubQuestionRubric[] = [];
                                // check if we actually found a match
                                // WARN: We only are looking for the first one that matches this string, we
                                // don't expect something to be the form of {something}{here}
                                if (rubricArray.length > 0) {
                                    const dirtySubQuestionString: string = rubricArray[0];
                                    // convert to an object
                                    // using https://stackoverflow.com/a/34763398
                                    const cleanSubQuestionString: string = dirtySubQuestionString.replace(
                                        /(['"])?([a-z0-9A-Z_]+)(['"])?:/g, '"$2": ');
                                    const subQuestionObj = JSON.parse(cleanSubQuestionString);
                                    // now we are able to get the mapping of values
                                    const keyArray: string[] = Object.keys(subQuestionObj);
                                    for (const key of keyArray) {
                                        // TODO: Look up if this splits anymore
                                        // the key is the rubric critera, and value is
                                        // the score that it is out of
                                        const rawValue = subQuestionObj[key];
                                        let value: number;
                                        if (typeof rawValue === 'string') {
                                            try {
                                                value = Number(rawValue);
                                            } catch (err) {
                                                Log.error("RubricController::updateRubric(..)::readFile(..) - error " +
                                                    "casting " + rawValue + " to a number; error: " + err);
                                            }
                                        } else {
                                            value = rawValue;
                                        }

                                        // setup possible modifiers for this question
                                        const modifiers = [];

                                        // if the question is bonus; indicate it
                                        if (bonusQuestion === true) {
                                            modifiers.push("bonus");
                                        }

                                        if (/raw.*/g.test(key)) {
                                            modifiers.push("numerical");
                                        }

                                        const newSubQuestionRubric: SubQuestionRubric = {
                                            name:           key,
                                            description:    "",
                                            outOf:          value,
                                            weight:         1,
                                            modifiers:      modifiers
                                        };

                                        subQuestionArray.push(newSubQuestionRubric);
                                    }

                                    // once you get the information
                                    const newQuestion: QuestionRubric = {
                                        name:         cleanedHeader,
                                        description:  "",
                                        subQuestions: subQuestionArray
                                    };

                                    newQuestions.push(newQuestion);
                                } else {
                                    // Log.info("RubricController::updateRubric(..) - skipping lone");
                                }
                            }

                            const assignGradingRubric: AssignmentRubric = {
                                questions: newQuestions
                            };

                            deliverableRecord.rubric = assignGradingRubric;

                            await this.db.writeDeliverable(deliverableRecord);
                            resolve(true);
                        }
                    });
                })) as Promise<boolean>);
            } else {
                Log.error("RubricController::updateRubric(..) - main file does not exist in repo");
                return false;
            }
        } catch (error) {
            Log.error(`RubricController::updateRubric(..) - Error: ${JSON.stringify(error)}`);
            return false;
        }
    }

    /**
     * searches backwards through the data starting at the index, for the regex supplied
     * @param data
     * @param index
     * @param regexp
     */
    private reverseBack(data: string[], index: number, regexp: RegExp): string {
        for (let i = index; i >= 0; i--) {
            if (regexp.test(data[i])) {
                return data[i];
            }
        }
        return "";
    }

    private async cloneRepo(repoUrl: string, repoPath: string) {
        const exec = require('child-process-promise').exec;
        const authedRepo: string = await this.gha.addGithubAuthToken(repoUrl);
        Log.info('RubricController::cloneRepo(..) - cloning from: ' + repoUrl);
        return exec(`git clone ${authedRepo} ${repoPath}`)
            .then(function(result: any) {
                Log.info('GithubManager::writeFileToRepo(..)::cloneRepo() - done:');
                Log.trace('GithubManager::writeFileToRepo(..)::cloneRepo() - stdout: ' + result.stdout);
                if (result.stderr) {
                    Log.warn('GithubManager::writeFileToRepo(..)::cloneRepo() - stderr: ' + result.stderr);
                }
            });
    }

}
