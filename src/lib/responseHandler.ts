import { Response } from 'express';

export const handleError = (res: Response, statusCode: number, message: string, data: any = null) => {
  return res.status(statusCode).json({
    success: false,
    message: message,
    data: data,
  });
};

export const handleSuccess = (res: Response, statusCode: number, message: string, data: any = null) => {
  return res.status(statusCode).json({
    success: true,
    message: message,
    data: data,
  });
};
