import { Router, type IRouter } from "express";
import healthRouter from "./health";
import paymentsRouter from "./payments";
import sessionsRouter from "./sessions";
import apiKeysRouter from "./apikeys";

const router: IRouter = Router();

router.use(healthRouter);
router.use(paymentsRouter);
router.use(sessionsRouter);
router.use(apiKeysRouter);

export default router;
