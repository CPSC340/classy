import * as restify from "restify";
import Log from "../../../../common/Log";
import {AssignmentGrade} from "../../../../common/types/CS340Types";
import {
    DeliverableTransport,
    Payload,
    RepositoryTransport,
    TeamTransport
} from "../../../../common/types/PortalTypes";
import Util from "../../../../common/Util";
import {AdminController} from "../controllers/AdminController";
import {AuthController} from "../controllers/AuthController";
import {CourseController} from "../controllers/CourseController";
import {DatabaseController} from "../controllers/DatabaseController";
import {DeliverablesController} from "../controllers/DeliverablesController";
import {GitHubActions} from "../controllers/GitHubActions";
import {GitHubController} from "../controllers/GitHubController";
import {PersonController} from "../controllers/PersonController";
import {RepositoryController} from "../controllers/RepositoryController";
import {TeamController} from "../controllers/TeamController";
import IREST from "../server/IREST";
import {AuditLabel, Deliverable, Grade, Person, Repository, Team} from "../Types";
import {AssignmentController} from "./AssignmentController";
import {RubricController} from "./RubricController";
import {ScheduleController} from "./ScheduleController";

export default class CustomCourseRoutes implements IREST {

    public registerRoutes(server: restify.Server) {
        Log.info('CS340Routes::registerRoutes() - start');

        server.get("/portal/cs340/retrieveRepoUrl/:sid/:delivId", CustomCourseRoutes.retrieveRepoUrl);
        server.get("/portal/cs340/getStudentTeamByDeliv/:sid/:delivId", CustomCourseRoutes.getStudentTeamByDeliv);
        server.get("/portal/cs340/deliverables", CustomCourseRoutes.getDeliverables);
        server.get("/portal/cs340/getAssignmentGrade/:delivId/:studentId", CustomCourseRoutes.getAssignmentGrade);

        server.post("/portal/cs340/generateRubric/:delivId", CustomCourseRoutes.generateRubric);
        server.put("/portal/cs340/setAssignmentGrade/:sid/:delivId", CustomCourseRoutes.setAssignmentGrade);

        server.post("/portal/cs340/createAllRepositories/:delivId", CustomCourseRoutes.createAllRepositories);
        server.post("/portal/cs340/releaseAllRepositories/:delivId", CustomCourseRoutes.releaseAllRepositories);
        server.post("/portal/cs340/closeAssignmentRepositories/:delivId", CustomCourseRoutes.closeAssignmentRepositories);

        server.post("/portal/cs340/verifyScheduledTasks/:delivId", CustomCourseRoutes.verifyScheduledTasks);
        server.post("/portal/cs340/verifyAllScheduledTasks/", CustomCourseRoutes.verifyAllScheduledTasks);

        server.post("/portal/cs340/provision/:delivId/:repoId", CustomCourseRoutes.provisionOverride);
        server.post('/portal/cs340/release/:repoId', CustomCourseRoutes.releaseOverride);

        server.get("/portal/cs340/getNextUngradedSameLab/:delivId/:sid", CustomCourseRoutes.getNextUngradedSameLab);
        server.get("/portal/cs340/getNextUngraded/:delivId/:sid", CustomCourseRoutes.getNextUngraded);

        server.get("/portal/cs340/isFinalGradeReleased", CustomCourseRoutes.isFinalGradeReleased);
        server.post("/portal/cs340/toggleFinalGradeRelease", CustomCourseRoutes.toggleFinalGradeRelease);
        server.get("/portal/cs340/retrieveStudentsGrades/:delivId", CustomCourseRoutes.retrieveStudentsGrades);
    }
    public static async getNextUngraded(req: any, res: any, next: any) {
        Log.info(`CS340Routes::getNextUngraded(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;
        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (!isValid.isAdmin && !isValid.isStaff) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const delivId = req.params.delivId;
            const sid = req.params.sid;

            const db: DatabaseController = DatabaseController.getInstance();
            const gradePromise = db.getGrades();
            const teamsPromise = db.getTeams();
            const personsPromise = db.getPeople();

            const [grades, teams, persons] = await Promise.all([gradePromise, teamsPromise, personsPromise]);

            // build a id:grade map
            const gradeMap: Map<string, Grade> = new Map<string, Grade>();
            (grades as Grade[]).filter((grade) => {
                return grade.delivId === delivId;
            }).forEach((grade) => {
                gradeMap.set(grade.personId, grade);
            });

            // build a id:persons map
            const personMap: Map<string, Person> = new Map<string, Person>();
            (persons as Person[]).forEach((person) => {
                personMap.set(person.id, person);
            });

            // if (!personMap.has(sid)) {
            //     res.send(404, {error: `Invalid student ID specified, could not find student!`});
            //     return next();
            // }

            // const labId = personMap.get(sid).labId;

            // filter teams to just this deliverable, and no grades
            const filteredTeams = (teams as Team[]).filter((team) => {
                return team.delivId === delivId;
            }).filter((team) => {
                const personId = team.personIds[0];
                const person = personMap.get(personId);

                // if (person.labId !== labId) {
                //     return false;
                // }

                if (!gradeMap.has(personId)) {
                    return true;
                }

                const grade = gradeMap.get(personId);
                if (typeof grade.custom.assignmentGrade === "undefined") {
                    Log.error(`CS340Routes::getNextUngradedSameLab(..) - Error: Invalid Grade found: ${grade}`);
                    return false;
                }

                return !grade.custom.assignmentGrade.fullyGraded;
            }).sort((item1, item2) => {
                if (item1.personIds[0] > item2.personIds[0]) {
                    return 1;
                } else if (item1.personIds[0] < item2.personIds[0]) {
                    return -1;
                } else {
                    return 0;
                }
            });

            const cleanedTeams: Team | undefined = filteredTeams.find((team) => {
               return !team.personIds.includes(sid);
            });

            if (typeof cleanedTeams === "undefined" || cleanedTeams === null) {
                res.send(404, {error: `Unable to find an ungraded team`});
            } else {
                res.send(200, {response: cleanedTeams.personIds[0]});
            }

            // Log.info(`CS340Routes::getNextUngraded(..) - Found ${cleanedTeams.length} teams that need grading`);
            // if (cleanedTeams.length > 0) {
            //     res.send(200, {response: filteredTeams[0].personIds[0]});
            // } else {
            //     res.send(404, {error: `Unable to find an ungraded team`});
            // }
        }

        return next();
    }

    public static async getNextUngradedSameLab(req: any, res: any, next: any) {
        Log.info(`CS340Routes::getNextUngradedSameLab(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;
        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (!isValid.isAdmin && !isValid.isStaff) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const delivId = req.params.delivId;
            const sid = req.params.sid;

            const db: DatabaseController = DatabaseController.getInstance();
            const gradePromise = db.getGrades();
            const teamsPromise = db.getTeams();
            const personsPromise = db.getPeople();

            const [grades, teams, persons] = await Promise.all([gradePromise, teamsPromise, personsPromise]);

            // build a id:grade map
            const gradeMap: Map<string, Grade> = new Map<string, Grade>();
            (grades as Grade[]).filter((grade) => {
                return grade.delivId === delivId;
            }).forEach((grade) => {
                gradeMap.set(grade.personId, grade);
            });

            // build a id:persons map
            const personMap: Map<string, Person> = new Map<string, Person>();
            (persons as Person[]).forEach((person) => {
                personMap.set(person.id, person);
            });

            if (!personMap.has(sid)) {
                res.send(404, {error: `Invalid student ID specified, could not find student!`});
                return next();
            }

            const labId = personMap.get(sid).labId;

            // filter teams to just this deliverable, and no grades
            const filteredTeams = (teams as Team[]).filter((team) => {
                return team.delivId === delivId;
            }).filter((team) => {
                const personId = team.personIds[0];
                const person = personMap.get(personId);

                if (person.labId !== labId) {
                    return false;
                }

                if (!gradeMap.has(personId)) {
                    return true;
                }

                const grade = gradeMap.get(personId);
                if (typeof grade.custom.assignmentGrade === "undefined") {
                    Log.error(`CS340Routes::getNextUngradedSameLab(..) - Error: Invalid Grade found: ${grade}`);
                    return false;
                }

                return !grade.custom.assignmentGrade.fullyGraded;
            }).sort((item1, item2) => {
                if (item1.personIds[0] > item2.personIds[0]) {
                    return 1;
                } else if (item1.personIds[0] < item2.personIds[0]) {
                    return -1;
                } else {
                    return 0;
                }
            });

            // Log.info(`CS340Routes::getNextUngradedSameLab(..) - Found ${filteredTeams.length} teams that need grading`);
            // if (filteredTeams.length > 0) {
            //     res.send(200, {response: filteredTeams[0].personIds[0]});
            // } else {
            //     res.send(404, {error: `Unable to find an ungraded team`});
            // }
            const cleanedTeams: Team | undefined = filteredTeams.find((team) => {
                return !team.personIds.includes(sid);
            });

            if (typeof cleanedTeams === "undefined" || cleanedTeams === null) {
                res.send(404, {error: `Unable to find an ungraded team`});
            } else {
                res.send(200, {response: cleanedTeams.personIds[0]});
            }
        }

        return next();
    }

    public static async createAllRepositories(req: any, res: any, next: any) {
        Log.info(`CS340Routes::createAllRepositories(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;
        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (!isValid.isAdmin) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const assignmentController: AssignmentController = new AssignmentController();
            const db: DatabaseController = DatabaseController.getInstance();

            // verify that the deliverable exists
            const deliverableRecord: Deliverable = await db.getDeliverable(req.params.delivId);
            if (deliverableRecord === null) {
                res.send(400, {error: `Improper usage; please specify valid deliverable ID`});
                return next();
            }

            const success = await assignmentController.createAllRepositories(deliverableRecord.id);

            res.send(200, {result: success});
        }
        return next();
    }

    public static async getAssignmentGrade(req: any, res: any, next: any) {
        Log.info(`CS340Routes::getAssignmentGrade(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;
        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (isValid.isAdmin === false && isValid.isStaff === false) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const delivId = req.params.delivId;
            const studentId = req.params.studentId;

            const db: DatabaseController = DatabaseController.getInstance();
            const grade: Grade = await db.getGrade(studentId, delivId);
            if (grade === null) {
                res.send(404, {error: `Unable to find grade with student ID and deliverable ID`});
            } else {
                if (typeof grade.custom.assignmentGrade === "undefined" || grade.custom.assignmentGrade === null) {
                    res.send(400, {error: `Grade is not an assignment grade`});
                } else {
                    res.send(200, {response: grade.custom.assignmentGrade});
                }
            }
            return next();
        }
    }

    public static async releaseAllRepositories(req: any, res: any, next: any) {
        Log.info(`CS340Routes::releaseAllRepositories(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;
        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (!isValid.isAdmin) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const assignmentController: AssignmentController = new AssignmentController();
            const db: DatabaseController = DatabaseController.getInstance();

            // verify that the deliverable exists
            const deliverableRecord: Deliverable = await db.getDeliverable(req.params.delivId);
            if (deliverableRecord === null) {
                res.send(400, {error: `Improper usage; please specify valid deliverable ID`});
                return next();
            }

            const success = await assignmentController.releaseAllRepositories(deliverableRecord.id);

            res.send(200, {result: success});
        }
        return next();
    }

    public static async setAssignmentGrade(req: any, res: any, next: any) {
        Log.info(`CS340Routes::setAssignmentGrade(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;
        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (isValid.isAdmin === false && isValid.isStaff === false) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        }

        let reqBody: AssignmentGrade;
        if (typeof req.body === 'string') {
            reqBody = JSON.parse(req.body);
        } else {
            reqBody = req.body;
        }

        if (reqBody === null) {
            Log.error("Unable to get request body: " + req.body);
            res.send(400, {error: "Invalid request"});
            return next();
        }

        Log.info("CS340REST::setAssignmentGrade() - reqBody = " + JSON.stringify(reqBody));

        const assignId: string = req.params.delivId;
        const studentId: string = req.params.sid;

        Log.info("CS340REST::setAssignmentGrade() - aid: " + assignId + " sid: " + studentId);

        const assignController = new AssignmentController();
        const personController = new PersonController();
        const repoController = new RepositoryController();
        const teamController = new TeamController();
        const db = DatabaseController.getInstance();

        const result: Person = await personController.getPerson(studentId);
        let success: boolean;
        if (result === null) {
            res.send(400, {error: "Invalid student ID, unable to record grade"});
            return next();
        }

        const repos: Repository[] = await repoController.getReposForPerson(result);

        const repo = repos.find((record) => {
            return record.delivId === assignId;
        });

        if (repo === null) {
            let totalGrade = 0;
            for (const aQuestion of reqBody.questions) {
                for (const aSubQuestion of aQuestion.subQuestions) {
                    // Sum up all subcompartment grades
                    totalGrade += aSubQuestion.grade;
                }
            }

            const newGrade: Grade = {
                personId: result.id,
                delivId:  assignId,

                score:     totalGrade,
                comment:   "Marked by " + user,
                timestamp: Date.now(),

                urlName: "",
                URL:     "",

                custom: {
                    assignmentGrade: reqBody
                }
            };

            await db.writeGrade(newGrade);
            res.send(200, {response: "Success"});
            return next();
        } else {
            success = await assignController.setAssignmentGrade(repo.id, assignId, reqBody, user);
        }

        if (success) {
            res.send(200, {response: "Success"});
        } else {
            res.send(500, {error: "Unable to write to database"});
        }
        Log.info("CS340REST::setAssignmentGrade() - end");
        return next();
    }

    public static async getStudentTeamByDeliv(req: any, res: any, next: any) {
        Log.info(`CS340Routes::getStudentTeamByDeliv(..) - start`);
        Log.warn(`Warning: This should be replaced at some point with front-end logic to retrieve teams`);

        const user = req.headers.user;
        const token = req.headers.token;
        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (isValid.isStaff === false && isValid.isAdmin === false) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const studentId: string = req.params.sid;
            const delivId: string = req.params.delivId;

            const pc: PersonController = new PersonController();
            const tc: TeamController = new TeamController();

            const personRecord: Person = await pc.getPerson(studentId);
            if (personRecord === null) {
                res.send(400, {error: `Improper usage; please specify valid student ID`});
                return next();
            }

            const teams: Team[] = await tc.getTeamsForPerson(personRecord);
            for (const team of teams) {
                if (team.delivId === delivId) {
                    const teamTransport: TeamTransport = tc.teamToTransport(team);
                    Log.info(`CS340Routes::getStudentTeamByDeliv(..) - Found team: ${JSON.stringify(team)}`);
                    res.send(200, {response: teamTransport});
                    return next();
                }
            }
            res.send(400, {error: `Unable to find team for student: ${studentId} and deliverable: ${delivId}`});
            return next();
        }
    }

    public static async retrieveRepoUrl(req: any, res: any, next: any) {
        Log.info(`CS340Routes::retrieveRepoUrl(..) - start`);
        const user = req.headers.user;
        const token = req.headers.token;

        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (!isValid.isStaff) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const studentId: string = req.params.sid;
            const delivId: string = req.params.delivId;

            const rc: RepositoryController = new RepositoryController();
            const pc: PersonController = new PersonController();
            const student: Person = await pc.getPerson(studentId);
            if (student === null) {
                res.send(400, {error: `Improper usage; please specify valid student ID`});
                return next();
            }

            const repos: Repository[] = await rc.getReposForPerson(student);
            for (const repoRecord of repos) {
                if (repoRecord.delivId === delivId) {
                    res.send(200, {response: repoRecord.URL});
                    return next();
                }
            }
            res.send(400, {error: `Improper usage; unable to find repository for student ${studentId} and` +
                    `deliverable: ${delivId}`});
            return next();
        }
    }

    public static async generateRubric(req: any, res: any, next: any) {
        Log.info(`CS340Routes::generateRubric(..) - start`);
        const user = req.headers.user;
        const token = req.headers.token;

        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (!isValid.isAdmin) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const rubricController: RubricController = new RubricController();
            const delivId = req.params.delivId;

            if (typeof delivId === "undefined" || delivId === "") {
                res.send(400, {error: "Improper usage; please specify valid deliverable id"});
            } else {
                const updateResult = await rubricController.updateRubric(delivId);
                res.send(200, {response: updateResult});
            }
        }
        return next();
    }

    public static async closeAssignmentRepositories(req: any, res: any, next: any) {
        Log.info(`CS340Routes::closeAssignmentRepositories(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;

        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (!isValid.isAdmin) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const assignmentController: AssignmentController = new AssignmentController();
            const delivId = req.params.delivId;

            if (typeof delivId === "undefined" || delivId === "") {
                res.send(400, {error: "Improper usage; please specify valid deliverable id"});
            } else {
                const result = await assignmentController.closeAllRepositories(delivId);
                res.send(200, {response: result});
            }
        }

        return next();
    }

    public static async verifyScheduledTasks(req: any, res: any, next: any) {
        Log.info(`CS340Routes::verifyScheduledTasks(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;

        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (!isValid.isAdmin) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const sc: ScheduleController = ScheduleController.getInstance();
            const delivId = req.params.delivId;

            Log.info(`CS340Routes::verifyScheduledTasks(..) - DelivId: ${delivId}`);

            if (typeof delivId === "undefined" || delivId === "") {
                res.send(400, {error: "Improper usage; please specify valid deliverable id"});
            } else {
                try {
                    await sc.verifyScheduledAssignmentTasks(delivId);
                    res.send(200, {response: true});
                } catch (e) {
                    Log.error(`CS340Routes::verifyScheduledTasks(..) - ERROR: ${e}`);
                    res.send(400, {error: JSON.stringify(e)});
                }

            }
        }

        return next();
    }

    public static async verifyAllScheduledTasks(req: any, res: any, next: any) {
        Log.info(`CS340Routes::verifyAllScheduledTasks(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;

        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (!isValid.isAdmin) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const sc: ScheduleController = ScheduleController.getInstance();
            const dbc: DatabaseController = DatabaseController.getInstance();

            const deliverables: Deliverable[] = await dbc.getDeliverables();

            const schedulePromises: Array<Promise<void>> = [];

            for (const deliverable of deliverables) {
                schedulePromises.push(sc.verifyScheduledAssignmentTasks(deliverable.id));
            }

            await Promise.all(schedulePromises);

            res.send(200, {response: true});
        }

        return next();
    }

    /**
     * Student accessible deliverable info
     */
    public static async getDeliverables(req: any, res: any, next: any) {
        Log.info(`CS340Routes::getDeliverable(..) - start`);

        const dbc: DatabaseController = DatabaseController.getInstance();
        const deliverables: Deliverable[] = await dbc.getDeliverables();

        const deliverableTransports: DeliverableTransport[] = [];

        for (const deliv of deliverables) {
            deliverableTransports.push(DeliverablesController.deliverableToTransport(deliv));
        }

        res.send(200, {success: deliverableTransports});

        return next();
    }

    public static async isFinalGradeReleased(req: any, res: any, next: any) {
        Log.info(`CS340Routes::isFinalGradeReleased(..) - start`);

        const ac: AssignmentController = new AssignmentController();

        const result = await ac.getFinalGradeStatus();

        res.send(200, {success: result});
        return next();
    }

    public static async toggleFinalGradeRelease(req: any, res: any, next: any) {
        Log.info(`CS340Routes::isFinalGradeReleased(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;

        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        let result = false;
        if (!isValid.isAdmin) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
        } else {
            const asc: AssignmentController = new AssignmentController();

            result = await asc.toggleFinalGradeStatus();
            res.send(200, {success: result});
        }

        return next();
    }

    public static async retrieveStudentsGrades(req: any, res: any, next: any) {
        Log.info(`CS340Routes::retrieveStudentsGrades(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;

        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);

        if (!isValid.isAdmin) {
            Log.info(`CS340Routes::retrieveStudentsGrades(..) - Unauthorized usage of API: ${user}`);
        } else {
            Log.info(`CS340Routes::retrieveStudentsGrades(..) - Authorized`);
            const delivId = req.params.delivId;

            const db: DatabaseController = DatabaseController.getInstance();
            const grades = await db.getGrades();

            const filteredGrades: any = {};

            grades.filter((grade) => {
                return grade.delivId === delivId;
            }).forEach((grade) => {
                const rubricGrades: any = {};

                const questions = grade.custom.assignmentGrade.questions;

                questions.forEach((question) => {
                    rubricGrades[question.name] = [];
                    question.subQuestions.forEach((subQuestion) => {
                        const rubricRepresentation: any = {};
                        rubricRepresentation[subQuestion.name] = subQuestion.grade;
                        rubricRepresentation["feedback"] = subQuestion.feedback;
                        rubricGrades[question.name].push(rubricRepresentation);
                    });
                });

                rubricGrades["feedback"] = grade.custom.assignmentGrade.feedback;

                filteredGrades[grade.personId] = rubricGrades;
                Log.info(`CS340Routes::retrieveStudentsGrades(..) - RubricGrade: ${JSON.stringify(rubricGrades)}`);
            });

            res.send(200, JSON.stringify(filteredGrades));
        }
    }

    /**
     * A custom provision handler to integrate into the provisioning page. Transparently acts like the standard
     * provision repo API, but does some Assignment handling, if needed.
     * @param req
     * @param res
     * @param next
     */
    private static async provisionOverride(req: any, res: any, next: any) {
        Log.info(`CS340Routes::provisionOverride(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;

        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (isValid.isStaff === false && isValid.isAdmin === false) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
            return next();
        }

        let payload: Payload;
        // const user = req.headers.user;
        const delivId = req.params.delivId;
        const repoId = req.params.repoId;

        Log.info('CS340Routes::postProvision(..) - start; delivId: ' + delivId + '; repoId: ' + repoId);

        try {
            const success = await CustomCourseRoutes.provisionRepository(user, delivId, repoId);
            payload = {success: success};
            res.send(200, payload);
            return next(true);
        } catch (err) {
            Log.error(`CS340Routes:: Error - Unable to provision repo: ${err.message} `);
            res.send(400, {failure: {message: `Unable to provision repo: ${err.message}`}, shouldLogout: false});
            return next(false);
        }
    }

    /**
     * A custom release handler to integrate into the provisioning page. Transparently acts like the standard
     * release repo API, but does some Assignment handling, if needed.
     * @param req
     * @param res
     * @param next
     */
    private static async releaseOverride(req: any, res: any, next: any) {
        Log.info(`CS340Routes::releaseOverride(..) - start`);

        const user = req.headers.user;
        const token = req.headers.token;

        const ac = new AuthController();
        const isValid = await ac.isPrivileged(user, token);
        if (isValid.isStaff === false && isValid.isAdmin === false) {
            Log.info(`CS340Routes - Unauthorized usage of API: ${user}`);
            res.send(401, {
                error: "Unauthorized usage of API: If you believe this is an error, please contact the course admin"
            });
            return next();
        }

        let payload: Payload;
        const repoId = req.params.repoId;

        Log.info('CS340Routes::releaseOverride(..) - start; repoId: ' + repoId);
        try {
            const success = await CustomCourseRoutes.releaseRepository(user, repoId);
            payload = {success: success};
            res.send(200, payload);
            return next(true);
        } catch (err) {
            Log.error(`CS340Routes:: Error - Unable to provision repo: ${err.message} `);
            res.send(400, {failure: {message: `Unable to provision repo: ${err.message}`}, shouldLogout: false});
            return next(false);
        }
    }

    private static async releaseRepository(personId: string, repoId: string): Promise<RepositoryTransport[]> {
        const ghc = new GitHubController(GitHubActions.getInstance());
        const ac = new AdminController(ghc);

        // TODO: if course is SDMM, always fail
        const start = Date.now();
        const rc = new RepositoryController();

        const repo = await rc.getRepository(repoId);
        Log.info("CS340Routes::performRelease( " + personId + ", " + repoId + " ) - repo: " + repo);
        if (repo !== null) {
            const dbc = DatabaseController.getInstance();
            await dbc.writeAudit(AuditLabel.REPO_RELEASE, personId, {}, {}, {repoId: repoId});

            const releaseSucceeded = await ac.performRelease([repo], true);
            Log.info('CS340Routes::performRelease() - success; # results: ' + releaseSucceeded.length +
                '; took: ' + Util.took(start));
            return releaseSucceeded;

        } else {
            Log.error("CS340Routes::performRelease() - unknown repository: " + repoId);
        }
        // should never get here unless something goes wrong
        throw new Error("Perform release unsuccessful.");
    }

    private static async provisionRepository(personId: string, delivId: string, repoId: string): Promise<RepositoryTransport[]> {
        const dc: DatabaseController = DatabaseController.getInstance();
        const ac: AssignmentController = new AssignmentController();
        const deliv = await dc.getDeliverable(delivId);

        if (deliv !== null && deliv.shouldProvision === true) {
            await dc.writeAudit(AuditLabel.REPO_PROVISION, personId, {}, {}, {delivId: delivId, repoId: repoId});

            const repo = await dc.getRepository(repoId);
            if (repo !== null) {
                Log.info("CS340Routes::handleProvisionRepo( " + delivId + ", " + repoId + " ) - provisioning...");
                const provisionedRepos = await ac.provisionRepos([repo], deliv);
                Log.info("CS340Routes::handleProvisionRepo( " + delivId + ", " + repoId + " ) - provisioning complete.");
                return [RepositoryController.repositoryToTransport(repo)];
            } else {
                throw new Error("CS340Routes::handleProvisionRepo( " + delivId + ", " + repoId + " ) - null repository");
            }
        } else {
            throw new Error("CS340Routes::handleProvisionRepo( " + delivId + ", " + repoId + " ) - null deliverable");
        }
    }
}
