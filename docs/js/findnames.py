import glob,os


def fileNames(docFile,folder):
	docString="var "+folder+"=["
	for file in glob.glob("../docs/doc/"+folder+"/*.html"):

		docString+='"'+file.replace(".html","").split("/")[-1]+'",'
	
	docString=docString[:-1]
	docString+="]"
	docFile.write(docString+"\n")


docFile=open("../docs/js/docs.js","w")
fileNames(docFile,"documentation")
fileNames(docFile,"tutorials")

docFile.close()
