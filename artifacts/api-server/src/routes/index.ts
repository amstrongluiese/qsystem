import { Router, type IRouter } from "express";
import healthRouter from "./health";
import countersRouter from "./counters";
import queueRouter from "./queue";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(countersRouter);
router.use(queueRouter);
router.use(adminRouter);

export default router;
