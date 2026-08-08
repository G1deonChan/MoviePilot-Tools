from modelscope.pipelines import pipeline
from modelscope.utils.constant import Tasks
import gradio as gr
import os


class xiaolv_ocr_model():

    def __init__(self):
        model_small = r"./output_small"
        model_big = r"./output_big"
        self.ocr_recognition_small = pipeline(Tasks.ocr_recognition, model=model_small)
        self.ocr_recognition1_big = pipeline(Tasks.ocr_recognition, model=model_big)


    def run(self,pict_path,moshi = "small", context=[]):
        pict_path = pict_path.name
        context = [pict_path]

        if moshi == "small":
            result = self.ocr_recognition_small(pict_path)
        else:
            result = self.ocr_recognition1_big(pict_path)

        context += [str(result['text'][0])]
        responses = [(u, b) for u, b in zip(context[::2], context[1::2])]
        print(f"识别的结果为：{result}")
        os.remove(pict_path)
        return responses,context




if __name__ == "__main__":
    pict_path = r"C:\Users\ZBOM-Geil\Documents\GitHub\MoviePilot-Tools-2.0\public\ocr\image.png"
    ocr_model = xiaolv_ocr_model()
    # ocr_model.run(pict_path)