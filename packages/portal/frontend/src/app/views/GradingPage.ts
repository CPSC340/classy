import {OnsInputElement, OnsSearchInputElement} from "onsenui";
import Log from "../../../../../common/Log";
import {
    AssignmentGrade,
    AssignmentRubric,
    QuestionGrade, SubQuestionGrade,
    SubQuestionRubric
} from "../../../../../common/types/CS340Types";
import {DeliverableTransport, RepositoryTransport, TeamTransport} from "../../../../../common/types/PortalTypes";
import {Factory} from "../Factory";
import {UI} from "../util/UI";
import {AdminDeliverablesTab} from "./AdminDeliverablesTab";
import {AdminMarkingTab} from "./AdminMarkingTab";
import {AdminPage} from "./AdminPage";
import {AdminResultsTab} from "./AdminResultsTab";
import {AdminView} from "./AdminView";

const ERROR_POTENTIAL_INCORRECT_INPUT: string = "input triggered warning";
const ERROR_INVALID_INPUT: string = "invalid input";
const ERROR_NON_NUMERICAL_GRADE: string = "non-numerical grade entered";
const ERROR_NULL_RUBRIC: string = "null rubric-data";
const ERROR_MALFORMED_PAGE: string = "malformed page with info elements";
const WARN_EMPTY_FIELD: string = "empty field";

export class GradingPageView extends AdminPage {
    public static LETTER_GRADES_ENABLED: boolean = false;
    public static UBC_LETTER_GRADES: Map<string, {lower: number, upper: number}> = new Map<string, {lower: number, upper: number}>([
        ["A+", {lower: 90, upper: 100}],
        ["A" , {lower: 85, upper: 89}] ,
        ["A-", {lower: 80, upper: 84}] ,
        ["B+", {lower: 76, upper: 79}] ,
        ["B" , {lower: 72, upper: 75}] ,
        ["B-", {lower: 68, upper: 71}] ,
        ["C+", {lower: 64, upper: 67}] ,
        ["C" , {lower: 60, upper: 63}] ,
        ["C-", {lower: 55, upper: 59}] ,
        ["D" , {lower: 50, upper: 54}] ,
        ["F" , {lower: 0 , upper: 49}] ,
    ]);

    private letterGradeInputFilter: RegExp = new RegExp("^[ABC][-+]?$|^D$|^F$|^0$|^$");
    private numericalGradeInputFilter: RegExp = new RegExp("^-?\\d*\\.?\\d*?$");

    private studentId: string;
    private assignmentId: string;
    private isTeam: boolean;
    private rubric: AssignmentRubric;
    private previousSubmission: AssignmentGrade;

    constructor(remote: string) {
        super(remote);
    }

    public async init(opts: any): Promise<void> {
        Log.info(`GradingPage::init(..) - opts: ${JSON.stringify(opts)}`);
        this.studentId = opts.sid;
        this.assignmentId = opts.aid;
        this.isTeam = opts.isTeam;
        return await this.populateGradingPage(opts.aid, opts.sid, opts.isTeam);
    }

    public async populateGradingPage(delivId: string, studentId: string, isTeam: boolean = false): Promise<void> {
        Log.info(`GradingPage::populateGradingPage(${delivId}, ${studentId}, ${isTeam}) - start`);
        UI.showModal(`Populating grading view, please wait....`);

        const deliverables: DeliverableTransport[] = await AdminDeliverablesTab.getDeliverables(this.remote);
        const deliverable: DeliverableTransport = deliverables.find((deliverableTransport) => {
            return deliverableTransport.id === delivId;
        });

        if (deliverable === undefined || deliverable == null) {
            Log.error(`GradingPage::populateGradingPage(..) - ERROR: Unable to find deliverable object: ${delivId} in DB`);
            Log.error(`GradingPage::populateGradingPage(..) - deliverables: ${JSON.stringify(deliverables)}`);

            return null;
        }

        // retrieving rubric
        const rubric: AssignmentRubric = (deliverable.rubric) as AssignmentRubric;
        if (rubric === null) {
            // Log.error(`GradingPage::populateGradingPage(..) `);
            Log.error(`GradingPage::populateGradingPage(..) - ERROR: Assignment does not have a rubric`);
            // TODO: Attempt to generate rubric?
            return null;
        }

        this.rubric = rubric;
        Log.info(`GradingPage::populateGradingPage(${JSON.stringify(rubric)}`);

        const previousSubmission = await this.getPreviousSubmission(studentId, delivId);
        this.previousSubmission = previousSubmission;

        const assignmentInfoElement = document.getElementById('assignmentInfoSection');
        const gradingSectionElement = document.getElementById('gradingSection');

        const assignmentInfoList = document.createElement("div");
        const assignmentIDBox = document.getElementById("aidBox");
        const studentIDBox = document.getElementById("sidBox");

        const submissionBox = document.getElementById("submissionBox");
        let linkElement: HTMLElement;

        const options: any = AdminView.getOptions();
        const url = `${this.remote}/portal/cs340/retrieveRepoUrl/${studentId}/${delivId}`;
        const response = await fetch(url, options);
        const responseJson = await response.json();

        if (response.status === 200) {
            linkElement = document.createElement("a");
            linkElement.innerHTML = responseJson.response;
            (linkElement as HTMLLinkElement).href = responseJson.response;
            linkElement.setAttribute("target", "_blank");
        } else {
            linkElement = document.createElement("p");
            linkElement.innerHTML = responseJson.error;
        }

        submissionBox.appendChild(linkElement);

        if (isTeam) {
            const teamIndicator: HTMLParagraphElement = document.createElement("p");
            teamIndicator.innerHTML = "Editing team grade of: " + studentId;
            teamIndicator.id = "teamIndicator";
            assignmentInfoList.appendChild(teamIndicator);
        }

        const assignmentInfoAssignmentID = document.createElement("p");
        assignmentInfoAssignmentID.innerHTML = delivId;
        assignmentInfoAssignmentID.setAttribute("class", "aInfoID");

        const assignmentInfoStudentID = document.createElement("p");
        assignmentInfoStudentID.innerHTML = studentId;
        assignmentInfoStudentID.setAttribute("class", "aInfoSID");
        assignmentIDBox.appendChild(assignmentInfoAssignmentID);
        studentIDBox.appendChild(assignmentInfoStudentID);

        if (gradingSectionElement === null || assignmentInfoElement === null) {
            Log.error("GradingPage::populateGradingPage() - Unable to populate page due to missing elements");
            return;
        }

        assignmentInfoElement.appendChild(assignmentInfoList);

        // Create a "DID NOT COMPLETE" button
        const dncButton = document.createElement("ons-button");
        // dncButton.setAttribute("onclick", "window.myApp.view.submitGrade(false)");
        dncButton.onclick = async (evt) => {
            await this.submitReturn(this.studentId, this.assignmentId, false);
        };
        dncButton.setAttribute("style", "margin-left: 1em; background: red");
        dncButton.innerHTML = "No Submission";
        gradingSectionElement!.appendChild(dncButton);

        for (let i = 0; i < rubric.questions.length; i++) {
            // Get the i-th question
            const question = rubric.questions[i];

            const questionHeaderElement = document.createElement("h3");
            const questionHeader = document.createElement("span");
            const questionHeaderComponent1 = document.createElement("span");
            const questionHeaderComponent2 = document.createElement("span");

            // TODO: Check this
            questionHeaderComponent1.innerHTML = question.name;
            questionHeaderComponent1.setAttribute("class", "questionName");
            questionHeaderComponent2.setAttribute("class", "redText");
            questionHeaderComponent2.innerHTML = " *";

            questionHeader.appendChild(questionHeaderComponent1);
            questionHeader.appendChild(questionHeaderComponent2);
            questionHeaderElement.appendChild(questionHeader);
            gradingSectionElement.appendChild(questionHeaderElement);

            const questionBox = document.createElement("div");
            questionBox.setAttribute("class", "questionBox");

            for (let j = 0; j < question.subQuestions.length; j++) {
                const subQuestion: SubQuestionRubric = question.subQuestions[j];

                const questionSubBoxElement = document.createElement("div");
                questionSubBoxElement.setAttribute("class", "subQuestionBody");

                // Create the grade input element
                const subInfoBoxElement = document.createElement("div");
                subInfoBoxElement.setAttribute("class", "subQuestionInfoBox");

                // Contains the feedback box for the particular subquestion
                const subTextBoxElement = document.createElement("div");
                subTextBoxElement.setAttribute("class", "subQuestionTextBox");

                const subErrorBoxElement = document.createElement("div");
                subErrorBoxElement.setAttribute("class", "subQuestionErrorBox");

                // Create the grade input element
                const gradeInputElement = document.createElement("ons-input");
                if (GradingPageView.LETTER_GRADES_ENABLED === false || subQuestion.modifiers.includes("numerical")) {
                    // no letter grades, only numbers
                    this.setInputFilter(gradeInputElement, (val: string) => {
                        return this.numericalGradeInputFilter.test(val);
                    });
                } else {
                    // letter grades
                    this.setInputFilter(gradeInputElement, (val: string) => {
                        return this.letterGradeInputFilter.test(val);
                    });
                }

                if (previousSubmission === null || !previousSubmission.questions[i].subQuestions[j].graded) {
                    gradeInputElement.setAttribute("placeHolder", subQuestion.name);
                } else {
                    const lastGrade = previousSubmission.questions[i].subQuestions[j].grade;

                    if (GradingPageView.LETTER_GRADES_ENABLED === true) {
                        if (lastGrade === 0) {
                            (gradeInputElement as OnsInputElement).value = lastGrade.toString();
                        } else if (previousSubmission.questions[i].subQuestions[j].modifiers.includes("numerical")) {
                            (gradeInputElement as OnsInputElement).value = lastGrade.toString();
                        } else {
                            const letterGrade: string = GradingPageView.getLetterGrade(
                                lastGrade,
                                subQuestion.outOf);
                            gradeInputElement.setAttribute("placeHolder", letterGrade);
                            (gradeInputElement as OnsInputElement).value = letterGrade;
                        }
                    } else {
                        // letter grades are not enabled (only numerical)
                        gradeInputElement.setAttribute("placeHolder", lastGrade.toString());
                        (gradeInputElement as OnsInputElement).value = lastGrade.toString();
                    }
                }
                // gradeInputElement.setAttribute("data-type", subQuestion.name);
                gradeInputElement.setAttribute("modifier", "underbar");
                gradeInputElement.setAttribute("class", "subQuestionGradeInput");
                // gradeInputElement.setAttribute("onchange", "window.myApp.view.checkIfWarning(this)");
                gradeInputElement.onchange = (element) => {
                    this.checkIfWarning((element.target as HTMLInputElement).parentElement as OnsInputElement);
                };
                // gradeInputElement.setAttribute("onchange", "window.myApp.view.checkIfWarning(this)");
                // gradeInputElement.setAttribute("data-outOf", "" + subQuestion.outOf);
                gradeInputElement.innerHTML = subQuestion.name + " [out of " + subQuestion.outOf + "]";
                gradeInputElement.setAttribute("data-rubric", JSON.stringify(subQuestion));

                // Add grade input to infoBox
                subInfoBoxElement.appendChild(gradeInputElement);

                // Create error box that is initially invisible
                const errorBox = document.createElement("p");
                errorBox.setAttribute("class", "errorBox");

                // Add the error box to the info box section
                subInfoBoxElement.appendChild(errorBox);

                // Create input form for feedback form
                const textBoxElement = document.createElement("textArea");
                const textBoxLabelElement = document.createElement("p");
                textBoxLabelElement.innerHTML = "Comments & Feedback";
                textBoxLabelElement.setAttribute("class", "textboxLabel");
                textBoxElement.setAttribute("class", "textarea");
                textBoxElement.setAttribute("style", "width: 100%;height: 75%; min-width: 100px;min-height: 50px");
                if (previousSubmission !== null && previousSubmission.questions[i].subQuestions[j].graded) {
                    textBoxElement.innerHTML = previousSubmission.questions[i].subQuestions[j].feedback;
                }

                subTextBoxElement.appendChild(textBoxLabelElement);
                subTextBoxElement.appendChild(textBoxElement);

                // Add two subboxes to the subQuestion box
                questionSubBoxElement.appendChild(subInfoBoxElement);
                questionSubBoxElement.appendChild(subTextBoxElement);

                // Add the subQuestion to the question box
                questionBox.appendChild(questionSubBoxElement);
            }

            // Add the questionBox to the gradingSection
            gradingSectionElement!.appendChild(questionBox);
        }

        // Contains the feedback box for the general feedback form
        const generalFeedbackBoxElement = document.createElement("div");
        generalFeedbackBoxElement.setAttribute("class", "subQuestionTextBox");

        // create general feedback form
        const generalFeedbackElement = document.createElement("textArea");
        const generalFeedbackLabelElement = document.createElement("p");
        generalFeedbackLabelElement.innerHTML = "General Comments & Feedback";
        generalFeedbackLabelElement.setAttribute("class", "textboxLabel");
        generalFeedbackElement.setAttribute("class", "textarea");
        generalFeedbackElement.setAttribute("id", "grading-general-feedback");
        generalFeedbackElement.setAttribute("style",
            "width: 100%;height: 75%; min-width: 100px;" +
            "min-height: 50px; margin-bottom: 20px");

        // if there was a previous grading with feedback, keep it!
        if (previousSubmission !== null &&
            typeof previousSubmission.feedback !== "undefined" &&
            previousSubmission.feedback !== null) {
            generalFeedbackElement.innerHTML = previousSubmission.feedback;
        }

        generalFeedbackBoxElement.appendChild(generalFeedbackLabelElement);
        generalFeedbackBoxElement.appendChild(generalFeedbackElement);

        gradingSectionElement!.appendChild(generalFeedbackBoxElement);

        // Create a Save Grade button
        const submitButton = document.createElement("ons-button");
        submitButton.setAttribute("style", "margin-left: 10px; margin-right: 10px");
        // submitButton.setAttribute("onclick", "window.myApp.view.submitGrade()");
        submitButton.onclick = async (evt) => {
            await this.submitReturn(this.studentId, this.assignmentId);
        };
        submitButton.innerHTML = "Save Grade";

        gradingSectionElement!.appendChild(submitButton);

        // check if it is possible to create a next button
        const nextUngraded = await this.getNextUngraded(this.assignmentId, this.studentId);

        if (nextUngraded !== "") {
            Log.info(`GradingPage::populateGradingPage(..) - Creating ungraded button:`);
            const nextButton = document.createElement("ons-button");
            nextButton.onclick = async (evt) => {
                await this.submitNext(this.studentId, this.assignmentId, nextUngraded);
            };
            nextButton.setAttribute("style", "margin-left: 10px; margin-right: 10px");

            nextButton.innerHTML = "Next Ungraded";
            gradingSectionElement!.appendChild(nextButton);
        } else {
            Log.info(`GradingPage::populateGradingPage(..) - Did not find next person, skipping button creation:`);
        }

        // check if it is possible to create a next button for next ungraded lab
        const nextUngradedSameLab = await this.getNextUngradedSameLab(this.assignmentId, this.studentId);

        if (nextUngradedSameLab !== "") {
            Log.info(`GradingPage::populateGradingPage(..) - Creating ungraded, same lab button:`);
            const nextButton = document.createElement("ons-button");
            nextButton.onclick = async (evt) => {
                await this.submitNext(this.studentId, this.assignmentId, nextUngradedSameLab);
            };
            nextButton.setAttribute("style", "margin-left: 10px; margin-right: 10px");

            nextButton.innerHTML = "Next Ungraded (in same Lab)";
            gradingSectionElement!.appendChild(nextButton);
        } else {
            Log.info(`GradingPage::populateGradingPage(..) - Did not find next person, skipping button creation:`);
        }

        // check if it is possible to create a next button
        // const lastArray = AdminMarkingTab.lastGradingArray;

        // if (lastArray.length !== 0) {
        //     // begin searching for this current team
        //     let nextId = "";
        //     for (let i = 0; i < lastArray.length - 1; i++) {
        //         if (lastArray[i].people[0] === this.studentId) {
        //             Log.info(`GradingPage::populateGradingPage(..) - Found Student ID and next student: ${lastArray[i + 1]}`);
        //             nextId = lastArray[i + 1].people[0];
        //             break;
        //         }
        //     }
        //
        //     if (nextId !== "") {
        //         Log.info(`GradingPage::populateGradingPage(..) - Creating button:`);
        //         const nextButton = document.createElement("ons-button");
        //         nextButton.onclick = async (evt) => {
        //             await this.submitNext(this.studentId, this.assignmentId, nextId);
        //         };
        //         nextButton.setAttribute("style", "margin-left: 10px; margin-right: 10px");
        //
        //         nextButton.innerHTML = "Next Ungraded";
        //         gradingSectionElement!.appendChild(nextButton);
        //     } else {
        //         Log.info(`GradingPage::populateGradingPage(..) - Did not find next person, skipping button creation:`);
        //     }
        // } else {
        //     //
        //     Log.info(`GradingPage::populateGradingPage(..) - unable to find next studentId due to missing lastGradingArray`);
        // }

        return null;
    }

    private async getNextUngraded(deliverableId: string, studentId: string): Promise<string> {
        Log.info(`GradingPage::getNextUngraded(${deliverableId}, ${studentId}) - start`);
        // get class options
        const options: any = AdminView.getOptions();

        const url = `${this.remote}/portal/cs340/getNextUngraded/${deliverableId}/${studentId}`;
        const response = await fetch(url, options);

        if (response.status === 200) {
            const responseJSON = await response.json();
            return responseJSON.response;
        } else {
            Log.warn(`GradingPage::getNextUngraded(..) - Unable to find next student; Status code: ${response.status}`);
            return "";
        }
    }

    private async getNextUngradedSameLab(deliverableId: string, studentId: string): Promise<string> {
        Log.info(`GradingPage::getNextUngradedSameLab(${deliverableId}, ${studentId}) - start`);
        // get class options
        const options: any = AdminView.getOptions();

        const url = `${this.remote}/portal/cs340/getNextUngradedSameLab/${deliverableId}/${studentId}`;
        const response = await fetch(url, options);

        if (response.status === 200) {
            const responseJSON = await response.json();
            return responseJSON.response;
        } else {
            Log.warn(`GradingPage::getNextUngradedSameLab(..) - Unable to find next student in same lab; Status code: ${response.status}`);
            return "";
        }
    }

    /**
     * Returns the student's previous submission, or null
     * @param studentId
     * @param deliverableId
     */
    private async getPreviousSubmission(studentId: string, deliverableId: string): Promise<AssignmentGrade> {
        Log.info(`GradingPage::getPreviousSubmission(${studentId}, ${deliverableId}) - start`);

        // get class options
        const options: any = AdminView.getOptions();

        const url = `${this.remote}/portal/cs340/getAssignmentGrade/${deliverableId}/${studentId}`;
        const response = await fetch(url, options);

        if (response.status === 200) {
            const responseJSON = await response.json();
            this.previousSubmission = responseJSON.response;
        } else {
            Log.warn(`GradingPage::getPreviousSubmission - Unable to find previous submission; Status code: ${response.status}`);
            this.previousSubmission = null;
        }

        return this.previousSubmission;
    }

    private async submitReturn(studentId: string, deliverableId: string, completed: boolean = true): Promise<void> {
        if (await this.submitGrade(studentId, deliverableId, completed)) {
            UI.popPage();
        }
        return;
    }

    private async submitNext(studentId: string, deliverableId: string, nextStudentId: string): Promise<void> {
        if (!await this.submitGrade(studentId, deliverableId, true)) {
            Log.warn(`GradingPage::submitNext(..) - Something went wrong! Unable to save grade.`);
            return;
        }

        await UI.replacePage(Factory.getInstance().getHTMLPrefix() + '/GradingView.html', {
            sid: nextStudentId,
            aid: deliverableId,
            isTeam: this.isTeam
        });
    }

    /**
     * Scrapes the page and creates a grade to save
     * @param studentId
     * @param deliverableId
     * @param completed
     */
    private async submitGrade(studentId: string, deliverableId: string, completed: boolean = true): Promise<boolean> {
        let errorStatus = false;
        let warnStatus = false;
        let warnComment: string = "";
        let errorComment: string = "";
        const questionArray: QuestionGrade[] = [];
        const questionBoxes = document.getElementsByClassName("questionBox");

        for (let i = 0; i < questionBoxes.length; i++) {
            // A single question box, representative of many subquestions
            const questionBox = questionBoxes[i];
            // Get each subquestion from the questionBox
            const subQuestions = questionBox.getElementsByClassName("subQuestionBody");
            // initalize an array to place all the information inside
            const subQuestionArray: SubQuestionGrade[] = [];

            // for each subQuestion
            // tslint:disable-next-line
            for (let j = 0; j < subQuestions.length; j++) {
                // Get a single subQuestion
                const subQuestion = subQuestions[j];

                // Grab the elements associated with the subQuesiton
                const gradeInputElements = subQuestion.getElementsByClassName("subQuestionGradeInput");
                const errorElements = subQuestion.getElementsByClassName("errorBox");
                const responseBoxElements = subQuestion.getElementsByClassName("textarea");

                // Check if there is exactly one element in each
                // otherwise something is wrong with the webpage
                if (gradeInputElements.length !== 1 ||
                    responseBoxElements.length !== 1 ||
                    errorElements.length !== 1) {
                    // Display an error
                    Log.error("GradingPage::submitGrade - Error: Page is malformed");
                    return false;
                }

                // Grab the elements
                const gradeInputElement = gradeInputElements[0] as HTMLInputElement;
                const responseBoxElement = responseBoxElements[0] as HTMLTextAreaElement;
                const errorElement = errorElements[0] as HTMLElement;

                // Get the type from the embedded HTML data
                let rubricType: string = null;
                let subQuestionRubric: SubQuestionRubric;
                try {
                    subQuestionRubric = JSON.parse(gradeInputElement.getAttribute("data-rubric"));
                } catch (err) {
                    Log.error(`GradingPage::submitGrade - Error when retrieving subQuestionRubric Object: ${err}`);
                    continue;
                }

                rubricType = subQuestionRubric.name;

                // Retrieve the value inputted into the form field
                let gradeValue: number = 0;
                let graded = true;

                // If the value is not found, set it to a default empty string
                if (rubricType === null) {
                    rubricType = "";
                    if (!errorStatus) {
                        errorComment = ERROR_NULL_RUBRIC;
                    }
                    errorStatus = true;
                    continue;
                }

                const modifiers: string[] = [];

                // if the value causes a warning (invalid input)
                if (this.checkIfWarning(gradeInputElement)) {
                    errorComment = ERROR_INVALID_INPUT;
                    errorStatus = true;
                } else {
                    const enteredGrade: string = gradeInputElement.value.toUpperCase();

                    if (GradingPageView.LETTER_GRADES_ENABLED === true) {
                        // letter grades
                        if (GradingPageView.UBC_LETTER_GRADES.has(enteredGrade) === true) {
                            const gradeRange = GradingPageView.UBC_LETTER_GRADES.get(enteredGrade);
                            const multiplier = Math.ceil((gradeRange.upper + gradeRange.lower) / 2) / 100;
                            const outOf = subQuestionRubric.outOf;
                            gradeValue = multiplier * outOf;
                        } else {
                            if (enteredGrade === "0") {
                                gradeValue = 0;
                                modifiers.push("numerical");
                            } else if (enteredGrade === "") {
                                gradeValue = 0;
                                if (!warnStatus) {
                                    warnComment = WARN_EMPTY_FIELD;
                                }
                                warnStatus = true;
                                graded = false;
                                errorElement.innerHTML = "Warning: Input field is empty";
                            } else if (subQuestionRubric.modifiers.includes("numerical")) {
                                gradeValue = parseFloat(enteredGrade);
                                if (isNaN(gradeValue)) {
                                    gradeValue = 0;
                                }
                                modifiers.push("numerical");
                            } else {
                                gradeValue = 0;
                                if (!warnStatus) {
                                    warnComment = WARN_EMPTY_FIELD;
                                }
                                warnStatus = true;
                                graded = false;
                                errorElement.innerHTML = "Warning: Input field is empty";
                            }
                        }
                    } else {
                        // numerical grades
                        if (enteredGrade === "") {
                            // if it's empty, default to "zero" grade
                            gradeValue = 0;
                            if (!warnStatus) {
                                warnComment = WARN_EMPTY_FIELD;
                            }
                            warnStatus = true;
                            graded = false;
                            errorElement.innerHTML = "Warning: Input field is empty";
                        } else {
                            // if it has a digit, attempt to parse it
                            gradeValue = parseFloat(enteredGrade);
                            if (isNaN(gradeValue)) {
                                // if it's not a number, it's probably an error
                                gradeValue = 0;
                                warnStatus = true;
                                graded = false;
                                warnComment = ERROR_INVALID_INPUT;
                            }
                        }
                    }
                }

                // If the grade value retrieved is not a number, default the value to 0
                // if (gradeInputElement.value !== "" && isNaN(gradeValue)) {
                //     gradeValue = 0;
                //     if (!errorStatus) {
                //         errorComment = ERROR_NON_NUMERICAL_GRADE;
                //     }
                //     errorStatus = true;
                //     errorElement.innerHTML = "Error: Must specify a valid number";
                //     continue;
                // } else {
                //     // If the gradeValue is an actual number
                //     // check if there are any warnings about the input value
                //     if (this.checkIfWarning(gradeInputElement)) {
                //         if (!errorStatus) {
                //             errorComment = ERROR_POTENTIAL_INCORRECT_INPUT;
                //         }
                //         errorStatus = true;
                //     }
                // }

                // create a new subgrade, but if assignment was NOT _completed_, give 0
                const newSubGrade: SubQuestionGrade = {
                    name: rubricType,
                    grade:       completed ? gradeValue : 0,
                    graded:      completed ? graded : true,
                    feedback:    responseBoxElement.value,
                    modifiers:   modifiers,
                };

                subQuestionArray.push(newSubGrade);
            }

            const questionNames = document.getElementsByClassName("questionName");

            const newQuestion: QuestionGrade = {
                name: questionNames[i].innerHTML,
                comment:  "",
                subQuestions:  subQuestionArray
            };

            questionArray.push(newQuestion);
        }

        const aInfoSIDElements = document.getElementsByClassName("aInfoSID");
        const aInfoIDElements = document.getElementsByClassName("aInfoID");

        if (aInfoSIDElements.length !== 1 || aInfoIDElements.length !== 1) {
            if (!errorStatus) {
                errorComment = ERROR_MALFORMED_PAGE;
            }
            errorStatus = true;
        }

        if (errorStatus) {
            Log.error("GradingPage::submitGrade() - Unable to submit data; error: " + errorComment);
            return null;
        }

        if (warnComment === WARN_EMPTY_FIELD && !confirm(`Warning: Some parts of the form are not graded, do you` +
        ` wish to proceed?`)) {
            Log.info(`GradingPage::submitGrade() - Cancelling submission; empty field confirmation`);
            return null;
        }

        const sid = aInfoSIDElements[0].innerHTML;
        const aid = aInfoIDElements[0].innerHTML;

        // check some condition
        const teamIndicator: HTMLParagraphElement | null = (document.getElementById("teamIndicator") as HTMLParagraphElement);
        const targetStudentIds: string[] = [];
        if (teamIndicator !== null) {
            // this is kind of tricky, pull the team information out and get all the student IDs
            const teamOptions: any = AdminView.getOptions();
            const teamURL = this.remote + '/portal/cs340/getStudentTeamByDeliv/' + sid + "/" + aid;
            const teamResponse = await fetch(teamURL, teamOptions);
            if (teamResponse.status !== 200) {
                const errJson = await teamResponse.json();
                Log.error("CS340AdminView::submitGrade(..) - Error: " + errJson.error);
                UI.notification("Unable to save grade to team; unable to find correct team");
                return null;
            } else {
                const teamJson = await teamResponse.json();
                const team: TeamTransport = teamJson.response;
                for (const personId of team.people) {
                    targetStudentIds.push(personId);
                }
            }
        } else {
            targetStudentIds.push(sid);
        }

        let generalFeedback: string = "";
        const generalFeedbackElement: HTMLTextAreaElement = document.getElementById("grading-general-feedback") as HTMLTextAreaElement;
        if (generalFeedbackElement !== null) {
            generalFeedback = generalFeedbackElement.value;
        }

        return await this.submitGradeRecord(aid, targetStudentIds, questionArray, generalFeedback);
    }

    public async submitGradeRecord(aid: string, personIds: string[],
                                   questionArray: QuestionGrade[],
                                   assignmentFeedback: string): Promise<boolean> {
        Log.info("CS340AdminView::submitGradeRecord(..) - start");
        const allPromises: Array<Promise<any>> = [];
        UI.showModal("Submitting grade(s), please wait...");

        for (const personId of personIds) {
            // create a new grade
            const newAssignmentGrade: AssignmentGrade = {
                fullyGraded:    false,
                questions:      questionArray,
                feedback:       assignmentFeedback,
            };

            const verifiedAssignmentGrade: AssignmentGrade = this.verifyMarkedAssignmentGrade(newAssignmentGrade);

            const url = this.remote + `/portal/cs340/setAssignmentGrade/${personId}/${aid}`;
            Log.info("GradingPage::submitGrade() - uri: " + url);

            // Call the function
            const options: any = AdminView.getOptions();

            options.method = 'put';
            options.headers.Accept = 'application/json';
            options.json = true;
            options.body = JSON.stringify(verifiedAssignmentGrade);

            Log.info("GradingPage::submitGrade() - request body: " + options.body);

            allPromises.push(fetch(url, options));
        }

        const resultArray = await Promise.all(allPromises);

        for (const response of resultArray) {
            Log.info("GradingPage::submitGrade() - response from api " + response);
            if (response.status !== 200) {
                const errResponse = await response.json();
                Log.trace("CS340AdminView::submitGrade() - error submitting grades, code: " +
                    response.status + " error: " + response.statusText);
                // alert(errResponse.error);
                UI.showAlert(errResponse.error);
                UI.hideModal();
                return false;
            }
        }
        UI.hideModal();
        Log.info("CS340AdminView::submitGradeRecord(..) - end");

        return true;
    }

    /**
     * Checks if the input value should be causing any warnings, and updates the related field
     * @param gradeInputElement
     */
    private checkIfWarning(gradeInputElement: OnsInputElement): boolean {
        // TODO: Complete this
        // data-outOf
        Log.info(`GradingPage::checkIfWarning(${JSON.stringify(gradeInputElement)} - start`);
        Log.info(`Parameter: ${gradeInputElement.value}`);
        // const gradeValue: number = parseFloat(gradeInputElement.value);
        // const gradeOutOf: number = parseFloat(gradeInputElement.getAttribute("data-outOf"));
        // const parentElement: HTMLElement = gradeInputElement.parentElement;
        // const errorBox = parentElement.getElementsByClassName("errorBox");
        // if (gradeValue < 0 || gradeValue > gradeOutOf) {
        //     errorBox[0].innerHTML = "Warning: Grade out of bounds";
        //     return true;
        // } else {
        //     errorBox[0].innerHTML = "";
        //     return false;
        // }
        let subQuestionRubric: SubQuestionRubric;
        try {
            subQuestionRubric = JSON.parse(gradeInputElement.getAttribute("data-rubric"));
        } catch (err) {
            Log.error(`GradingPage::checkIfWarning(..) - ERROR trying to find subQuestionRubric: ${err}`);
            return true;
        }

        const letterGradeRegExp = new RegExp(/^[ABC][\-\+]?$|^D$|^F$|^0$|^$/, 'i');
        const numericalGradeRegExp = new RegExp(/^\d+(\.\d+)?$|^$/);
        const value = gradeInputElement.value;
        const parentElement: HTMLElement = gradeInputElement.parentElement;
        const errorBox = parentElement.getElementsByClassName("errorBox");

        let match = false;

        if (GradingPageView.LETTER_GRADES_ENABLED === false) {
            match = numericalGradeRegExp.test(value);
        } else if (subQuestionRubric.modifiers.includes("numerical")) {
            match = numericalGradeRegExp.test(value);
        } else {
            match = letterGradeRegExp.test(value);
        }

        if (match) {
            errorBox[0].innerHTML = "";
            return false;
        } else {
            errorBox[0].innerHTML = "ERROR: Invalid input";
            return true;
        }
    }

    /**
     * Verifies if the assignment is fully graded or not, then returns the Assignment grade
     * @param {AssignmentGrade} assignmentGrade
     * @returns {AssignmentGrade}
     */
    private verifyMarkedAssignmentGrade(assignmentGrade: AssignmentGrade): AssignmentGrade {
        for (const question of assignmentGrade.questions) {
            for (const subQuestion of question.subQuestions) {
                if (subQuestion.graded === false) {
                    assignmentGrade.fullyGraded = false;
                    return assignmentGrade;
                }
            }
        }
        assignmentGrade.fullyGraded = true;
        return assignmentGrade;
    }

    /**
     * Returns a letter grade that corresponds to the grade and the outOf
     */
    public static getLetterGrade(grade: number, outOf: number): string {
        if (grade === 0) {
            return "0";
        }
        const gradePercent = (grade / outOf) * 100;
        for (const key of GradingPageView.UBC_LETTER_GRADES.keys()) {
            const range = GradingPageView.UBC_LETTER_GRADES.get(key);
            if (range.lower <= gradePercent && gradePercent <= range.upper) {
                return key;
            }
        }

        return "";
    }

    public static getLetterGradeMidpoint(letterGrade: string): number {
        if (letterGrade === "0") {
            return 0;
        }
        const gradeRange = GradingPageView.UBC_LETTER_GRADES.get(letterGrade);
        if (gradeRange === null) {
            return 0;
        }

        return (gradeRange.upper + gradeRange.lower) / 2;
    }

    // Restricts input for the given textbox to the given inputFilter.
    // Inspiration retrieved from: https://jsfiddle.net/emkey08/zgvtjc51
    private setInputFilter(textbox: HTMLElement, inputFilter: (input: string) => boolean) {
        ["input", "keydown", "keyup", "mousedown", "mouseup", "select", "contextmenu", "drop"].forEach((event) => {
            textbox.addEventListener(event, function() {
                if (inputFilter(this.value)) {
                    this.oldValue = this.value;
                } else if (this.hasOwnProperty("oldValue")) {
                    this.value = this.oldValue;
                }
            });
        });
    }
}
